import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  shell,
  Tray,
} from 'electron';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { canHookShortcut, pasteWithKeyboard, registerModifierShortcuts, saveKeyHistory, setMenuMasking, stopModifierShortcuts, swallowsKeys } from './modifierShortcuts';
import { removeDuplicateShortcuts, ShortcutGroup, shortcutModes, toElectronAccelerator } from './shortcutBindings';
import { setRecordingMute } from './systemAudio';
import { checkForUpdate } from './updates';
import type { HudAction } from './hudActions';
import { hudHideDelay, HUD_SHRINK_DELAY_MS, planHudResize, type Size } from './hudBounds';
import { pasteIntoWindowsField, prepareWindowsPaste } from './windowsPaste';
import { captureDictationContext, readFocusedField, stopDictationContext, warmDictationContext } from './dictationContext';
import { watchPasteCorrections } from './pasteCorrections';

let mainWindow: BrowserWindow | null = null;
let hudWindow: BrowserWindow | null = null;
let hudReady = false;
let hudPayload: {
  show: boolean;
  state?: { status?: string; mode?: string; busyNotice?: boolean; shortcutList?: unknown[] };
} = { show: false };
let hudDisplayId: number | undefined;
let tray: Tray | null = null;
let isQuitting = false;
let quitAfterAudioRestore = false;
let shortcutEditorOpen = false;

const isDev = !app.isPackaged;
const iconsPath = path.join(__dirname, isDev ? '../public/icons' : '../dist/icons');
const appIconPath = path.join(iconsPath, 'app.png');

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'yapyap-store.json');
}

type Appearance = 'light' | 'dark' | 'system';
const DARK_BG = '#242121';
const LIGHT_BG = '#ffffff';

/** Reads only the saved appearance so the window opens in the right theme. */
function readSavedAppearance(): Appearance {
  try {
    const parsed = JSON.parse(fs.readFileSync(getStorePath(), 'utf8')) as {
      settings?: { appearance?: unknown };
    };
    const value = parsed.settings?.appearance;
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // no saved state yet
  }
  return 'light';
}

function applyAppearance(appearance: Appearance) {
  nativeTheme.themeSource = appearance;
  mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG);
}

function syncShortcutSuspension() {
  const suspended = shortcutEditorOpen && mainWindow?.isFocused() === true;
  globalShortcut.setSuspended(suspended);
  setMenuMasking(!suspended);
}

let escapeRegistered = false;

/** Esc cancels a recording or its processing from anywhere, and is left alone the rest of the time. */
function syncEscapeCancel() {
  const state = hudPayload.state;
  // Esc also cancels a dictation still processing.
  const recording = state?.status === 'recording' || state?.status === 'processing';
  if (recording === escapeRegistered) return;
  if (recording) {
    escapeRegistered = globalShortcut.register('Escape', () => {
      mainWindow?.webContents.send('hud:action', { type: 'cancel' } satisfies HudAction);
    });
  } else {
    globalShortcut.unregister('Escape');
    escapeRegistered = false;
  }
}

/** The page that owns the HUD state is gone, so nothing would ever clear it. */
function resetHud() {
  hudPayload = { show: false };
  updateHudWindow();
  syncEscapeCancel();
}

function createMainWindow(): void {
  nativeTheme.themeSource = readSavedAppearance();
  mainWindow = new BrowserWindow({
    width: 1140,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    icon: appIconPath,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // Open external links (API key portals, Share on X, etc.) in the user's default OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // The page paints its themed splash first, so the window never shows blank.
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  if (isDev) {
    void mainWindow.loadURL('http://localhost:5173');
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('close', (e) => {
    if (!isQuitting && tray) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    shortcutEditorOpen = false;
    syncShortcutSuspension();
  });
  mainWindow.on('focus', syncShortcutSuspension);
  mainWindow.on('blur', syncShortcutSuspension);
  mainWindow.webContents.on('render-process-gone', () => {
    shortcutEditorOpen = false;
    syncShortcutSuspension();
    resetHud();
    void setRecordingMute(false).catch(console.warn);
  });
  mainWindow.webContents.on('did-start-navigation', (event) => {
    if (event.isMainFrame && !event.isSameDocument) {
      shortcutEditorOpen = false;
      syncShortcutSuspension();
      resetHud();
      void setRecordingMute(false).catch(console.warn);
    }
  });
}

function createHudWindow(): void {
  hudWindow = new BrowserWindow({
    width: 148,
    height: 54,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Never focused, so keep it drawing at full speed.
      backgroundThrottling: false,
    },
  });

  // The window is larger than the HUD it draws; clicks on the transparent part
  // go to the app underneath. The HUD page turns this off while hovered.
  if (process.platform !== 'linux') hudWindow.setIgnoreMouseEvents(true, { forward: true });

  hudWindow.webContents.on('did-start-loading', () => {
    hudReady = false;
    if (process.platform !== 'linux') hudWindow?.setIgnoreMouseEvents(true, { forward: true });
    hudWindow?.hide();
  });
  hudWindow.webContents.on('render-process-gone', () => {
    hudReady = false;
    hudWindow?.hide();
  });
  if (isDev) {
    void hudWindow.loadURL('http://localhost:5173/#/hud');
  } else {
    void hudWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      hash: '/hud',
    });
  }

  hudWindow.on('closed', () => {
    hudReady = false;
    hudWindow = null;
    clearHudTimer();
  });
}

let hudResizeTimer: ReturnType<typeof setTimeout> | undefined;
/** What the waiting timer will do: shrink to this size, or hide the window. */
let hudPending: Size | 'hide' | undefined;
/** The status the HUD window last showed, to know if a pill has to shrink out. */
let hudShownStatus: string | undefined;

function clearHudTimer() {
  clearTimeout(hudResizeTimer);
  hudResizeTimer = undefined;
  hudPending = undefined;
}

/** Runs after the pill has animated, unless the window is gone by then. */
function afterHudAnimation(window: BrowserWindow, pending: Size | 'hide', run: () => void) {
  hudPending = pending;
  hudResizeTimer = setTimeout(() => {
    hudResizeTimer = undefined;
    hudPending = undefined;
    if (!window.isDestroyed()) run();
  }, HUD_SHRINK_DELAY_MS);
}

/** Places the HUD window at the bottom center of the work area at this size. */
function setHudSize(window: BrowserWindow, workArea: Electron.Rectangle, width: number, height: number) {
  const x = workArea.x + Math.round((workArea.width - width) / 2);
  const y = workArea.y + workArea.height - height - 4;
  const bounds = window.getBounds();
  if (bounds.width !== width || bounds.height !== height || bounds.x !== x || bounds.y !== y) {
    window.setBounds({ x, y, width, height });
  }
}

function updateHudWindow(): void {
  if (!hudWindow || !hudReady) return;
  if (!hudPayload.show) {
    if (hudPending === 'hide') return;
    clearHudTimer();
    const hide = (window: BrowserWindow) => {
      window.hide();
      hudDisplayId = undefined;
      hudShownStatus = undefined;
    };
    if (!hudWindow.isVisible() || hudHideDelay(hudShownStatus) === 0) {
      hide(hudWindow);
      return;
    }
    // Let the page shrink its pill out before the window goes.
    hudWindow.webContents.send('hud:state', { status: 'idle', mode: 'dictate', levels: [] });
    const window = hudWindow;
    afterHudAnimation(window, 'hide', () => hide(window));
    return;
  }
  if (hudPending === 'hide') clearHudTimer();

  const state = hudPayload.state;
  const display = screen.getAllDisplays().find((item) => item.id === hudDisplayId) ??
    screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  hudDisplayId = display.id;
  const { workArea } = display;
  let width = 152;
  let height = 56;
  if (state?.status === 'recording' && state.mode === 'ask') height = 96;
  if (state?.status === 'recording' && state.mode === 'translate') {
    width = 290;
    height = 215;
  }
  if (state?.status === 'cancelled' || state?.status === 'notice') width = 260;
  if (state?.status === 'armed' && state.shortcutList) {
    width = 300;
    height = 170;
  }
  if (state?.status === 'processing' && state.busyNotice) {
    // The notice sits above the Thinking pill, so leave room for both.
    width = 360;
    height = 220;
  }
  if (state?.status === 'error' || state?.status === 'result') {
    const answer = state.status === 'result' && state.mode === 'ask';
    width = answer ? 620 : 360;
    height = answer ? 334 : 230;
  }
  width = Math.min(width, workArea.width);
  height = Math.min(height, workArea.height - 12);
  // A visible window grows at once but shrinks only after the pill has animated,
  // so the pill is never cut off mid-animation.
  const target = { width, height };
  if (!hudWindow.isVisible()) {
    clearHudTimer();
    setHudSize(hudWindow, workArea, width, height);
  } else {
    const plan = planHudResize(hudWindow.getBounds(), target, hudPending === 'hide' ? undefined : hudPending);
    if (!plan.keepPending) {
      clearHudTimer();
      if (plan.now) setHudSize(hudWindow, workArea, plan.now.width, plan.now.height);
      const window = hudWindow;
      if (plan.later) afterHudAnimation(window, plan.later, () => setHudSize(window, workArea, width, height));
    }
  }
  hudShownStatus = state?.status;
  hudWindow.webContents.send('hud:state', state);
  if (!hudWindow.isVisible()) hudWindow.showInactive();
}

function createTray(): void {
  const trayIcon = process.platform === 'win32' ? 'tray.ico' : 'tray.png';

  try {
    tray = new Tray(path.join(iconsPath, trayIcon));
    tray.setToolTip('Yap Yap — Speak, don’t type');
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open Yap Yap',
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      { type: 'separator' },
      {
        label: 'Dictate',
        click: () => mainWindow?.webContents.send('trigger-mode', 'dictate'),
      },
      {
        label: 'Translate',
        click: () => mainWindow?.webContents.send('trigger-mode', 'translate'),
      },
      {
        label: 'Ask anything',
        click: () => mainWindow?.webContents.send('trigger-mode', 'ask'),
      },
      { type: 'separator' },
      {
        label: 'Save key history',
        click: () => saveKeyHistory(keyHistoryFile(), 'saved from tray'),
      },
      {
        label: 'Quit Yap Yap',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => {
      mainWindow?.show();
      mainWindow?.focus();
    });
  } catch (error) {
    console.warn('Yap Yap could not create the system tray', error);
  }
}

function registerAppShortcuts(shortcuts: ShortcutGroup): boolean {
  const unique = removeDuplicateShortcuts(shortcuts, process.platform);
  globalShortcut.unregisterAll();
  escapeRegistered = false;
  // Electron requires shortcut handling to be active when adding registrations.
  globalShortcut.setSuspended(false);
  const modifierShortcuts: Parameters<typeof registerModifierShortcuts>[0] = [];
  const claims: string[] = [];
  const maskCombos: string[][] = [];

  for (const mode of shortcutModes) {
    for (const combo of unique[mode]) {
      const accel = toElectronAccelerator(combo);
      const trigger = () => mainWindow?.webContents.send('trigger-mode', mode);
      if (canHookShortcut(combo) && (!accel || combo.includes('Right Alt'))) {
        modifierShortcuts.push({ combo, trigger });
        if (accel) claims.push(accel);
        continue;
      }
      if (!accel) continue;
      maskCombos.push(combo);
      try {
        globalShortcut.register(accel, trigger);
      } catch {
        // Ignore invalid/taken accelerator
      }
    }
  }
  try {
    registerModifierShortcuts(modifierShortcuts, {
      appStatus: () => {
        const status = hudPayload.state?.status;
        return status === 'recording' || status === 'processing' ? status : 'idle';
      },
      onPhase: (phase) => mainWindow?.webContents.send('shortcut:phase', phase),
      onStop: () => mainWindow?.webContents.send('hud:action', { type: 'stop' } satisfies HudAction),
    }, maskCombos);
    // uiohook only observes keys, so there the chord is also claimed to keep it from
    // the focused app (Alt+Space would open its window menu). Yap Yap's own Windows
    // hook swallows the chord itself, and a claim would also take Left Alt+Space.
    if (!swallowsKeys()) {
      for (const accel of claims) {
        try {
          globalShortcut.register(accel, () => undefined);
        } catch {
          // Another app owns it; the hook still triggers the mode.
        }
      }
    }
    return true;
  } catch (error) {
    console.warn('Could not register modifier-only shortcuts', error);
    return false;
  } finally {
    syncShortcutSuspension();
    syncEscapeCancel();
  }
}

const keyHistoryFile = () => path.join(app.getPath('userData'), 'key-history.log');

function pasteIntoFocusedField(): Promise<boolean> {
  if (process.platform === 'win32') {
    return pasteIntoWindowsField(pasteWithKeyboard).then((pasted) => {
      // A menu that took focus on the shortcut's Alt release makes the paste fail.
      if (!pasted) saveKeyHistory(keyHistoryFile(), 'paste failed');
      return pasted;
    });
  }

  // These commands can send the shortcut but cannot confirm insertion, so a
  // shortcut that was sent counts as pasted.
  return new Promise((resolve) => {
    if (process.platform === 'darwin') {
      exec(
        'osascript -e \'tell application "System Events" to keystroke "v" using command down\'',
        { timeout: 5000 },
        (err) => resolve(!err)
      );
    } else {
      exec('xdotool key --clearmodifiers ctrl+v', { timeout: 5000 }, (err) => resolve(!err));
    }
  });
}

app.whenReady().then(() => {
  if (isDev) app.dock?.setIcon(appIconPath);
  warmDictationContext();
  createMainWindow();
  createHudWindow();
  createTray();

  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window:close', () => {
    if (tray) mainWindow?.hide();
    else mainWindow?.close();
  });

  ipcMain.on('app:set-appearance', (_e, appearance: Appearance) => {
    if (appearance === 'light' || appearance === 'dark' || appearance === 'system') {
      applyAppearance(appearance);
    }
  });
  ipcMain.handle('app:set-login-item', (_e, enabled: boolean) => {
    try {
      app.setLoginItemSettings({ openAtLogin: enabled });
    } catch {
      // Ignore on unsupported Linux environments
    }
  });

  ipcMain.handle('audio:set-mute', (event, muted: boolean) =>
    event.sender === mainWindow?.webContents ? setRecordingMute(muted) : undefined);
  ipcMain.handle('app:check-for-update', (event) =>
    event.sender === mainWindow?.webContents ? checkForUpdate(app.getVersion()) : undefined);

  ipcMain.handle('shortcuts:update', (_e, shortcuts) => {
    return registerAppShortcuts(shortcuts);
  });

  ipcMain.on('shortcuts:editor', (event, open: boolean) => {
    if (event.sender !== mainWindow?.webContents) return;
    shortcutEditorOpen = open;
    syncShortcutSuspension();
  });

  ipcMain.handle('clipboard:paste', async (event, text: string) => {
    if (event.sender !== mainWindow?.webContents || typeof text !== 'string' || !text) return false;
    await clipboard.writeText(text);
    return pasteIntoFocusedField();
  });
  ipcMain.on('clipboard:prepare-paste', (event) => {
    if (event.sender === mainWindow?.webContents && process.platform === 'win32') prepareWindowsPaste();
  });
  ipcMain.handle('dictation:capture-context', (event) => {
    if (event.sender === mainWindow?.webContents && !mainWindow.isFocused()) return captureDictationContext();
  });
  ipcMain.handle('dictation:watch-corrections', (event, text: string) =>
    event.sender === mainWindow?.webContents && typeof text === 'string' && text.trim()
      ? watchPasteCorrections(text, readFocusedField)
      : { words: [] });
  ipcMain.handle('clipboard:copy', async (event, text: string) => {
    if (event.sender === mainWindow?.webContents) await clipboard.writeText(text);
  });

  ipcMain.on('hud:toggle', (event, payload: typeof hudPayload) => {
    if (event.sender !== mainWindow?.webContents) return;
    hudPayload = payload;
    if (payload.show && !hudWindow) createHudWindow();
    updateHudWindow();
    syncEscapeCancel();
  });

  ipcMain.on('hud:ready', (event) => {
    if (event.sender !== hudWindow?.webContents) return;
    hudReady = true;
    updateHudWindow();
  });

  ipcMain.on('hud:ignore-mouse', (event, ignore: boolean) => {
    if (event.sender !== hudWindow?.webContents || process.platform === 'linux') return;
    hudWindow.setIgnoreMouseEvents(ignore === true, { forward: true });
  });

  ipcMain.on('hud:action', async (event, action: HudAction) => {
    if (event.sender !== hudWindow?.webContents) return;
    if (action.type === 'copy' && typeof action.text === 'string') {
      await clipboard.writeText(action.text).catch(console.warn);
      return;
    }
    if (action.type === 'edit-targets') {
      if (mainWindow?.isMinimized()) mainWindow.restore();
      mainWindow?.show();
      mainWindow?.focus();
    }
    mainWindow?.webContents.send('hud:action', action);
  });

  ipcMain.handle('store:load', () => {
    try {
      const p = getStorePath();
      if (!fs.existsSync(p)) return null;
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as {
        history?: Array<{ id: string; audioDataUrl?: string }>;
        [k: string]: unknown;
      };
      const audioDir = path.join(app.getPath('userData'), 'audio');
      if (Array.isArray(parsed.history) && fs.existsSync(audioDir)) {
        for (const item of parsed.history) {
          if (!item.audioDataUrl && item.id) {
            const audioFile = path.join(audioDir, `${item.id}.txt`);
            if (fs.existsSync(audioFile)) {
              try {
                item.audioDataUrl = fs.readFileSync(audioFile, 'utf8');
              } catch {
                // ignore
              }
            }
          }
        }
      }
      return parsed;
    } catch {
      return null;
    }
  });

  ipcMain.handle('store:save', (_e, data: Record<string, unknown>) => {
    try {
      const p = getStorePath();
      const userDataDir = path.dirname(p);
      const audioDir = path.join(userDataDir, 'audio');
      fs.mkdirSync(audioDir, { recursive: true });

      // IPC already hands over a copy, so it can be changed in place.
      const clone = data as {
        history?: Array<{ id: string; audioDataUrl?: string; audioSaved?: boolean }>;
        [k: string]: unknown;
      };

      const activeAudioIds = new Set<string>();
      if (Array.isArray(clone.history)) {
        for (const item of clone.history) {
          // Audio already on disk arrives as a marker instead of the recording.
          if (item.id && item.audioSaved) activeAudioIds.add(`${item.id}.txt`);
          delete item.audioSaved;
          if (item.id && item.audioDataUrl) {
            activeAudioIds.add(`${item.id}.txt`);
            const audioFile = path.join(audioDir, `${item.id}.txt`);
            if (!fs.existsSync(audioFile)) {
              fs.writeFileSync(audioFile, item.audioDataUrl, 'utf8');
            }
            delete item.audioDataUrl;
          }
        }
      }

      const tmpPath = `${p}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(clone, null, 2), 'utf8');
      fs.renameSync(tmpPath, p);

      // Clean up deleted audio only after the updated history is on disk.
      for (const file of fs.readdirSync(audioDir)) {
        if (file.endsWith('.txt') && !activeAudioIds.has(file)) {
          try {
            fs.unlinkSync(path.join(audioDir, file));
          } catch {
            // ignore
          }
        }
      }

      return true;
    } catch {
      // Ignore write error
      return false;
    }
  });

  ipcMain.handle(
    'api:request',
    async (
      _e,
      req: {
        url: string;
        method: string;
        headers: Record<string, string>;
        bodyBase64?: string;
        bodyText?: string;
        timeoutMs?: number;
      }
    ) => {
      let body: BodyInit | undefined;
      if (req.bodyBase64) {
        body = Buffer.from(req.bodyBase64, 'base64');
      } else if (req.bodyText !== undefined) {
        body = req.bodyText;
      }

      const res = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body,
        signal: req.timeoutMs ? AbortSignal.timeout(req.timeoutMs) : undefined,
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    }
  );

  ipcMain.handle(
    'api:multipart',
    async (
      _e,
      req: {
        url: string;
        headers: Record<string, string>;
        fileBase64: string;
        fileName: string;
        mimeType: string;
        fields: Record<string, string | string[]>;
      }
    ) => {
      const form = new FormData();
      const buffer = Buffer.from(req.fileBase64, 'base64');
      const blob = new Blob([buffer], { type: req.mimeType });
      form.append('file', blob, req.fileName);
      for (const [k, v] of Object.entries(req.fields)) {
        for (const value of [v].flat()) form.append(k, value);
      }

      const res = await fetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: form,
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    }
  );
});

app.on('will-quit', () => {
  stopDictationContext();
  globalShortcut.unregisterAll();
  stopModifierShortcuts();
});

app.on('before-quit', (event) => {
  isQuitting = true;
  if (quitAfterAudioRestore) return;
  event.preventDefault();
  void setRecordingMute(false).catch(console.warn).finally(() => {
    quitAfterAudioRestore = true;
    app.quit();
  });
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  } else {
    mainWindow?.show();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
