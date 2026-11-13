import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
} from 'electron';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { canHookShortcut, pasteWithKeyboard, registerModifierShortcuts, stopModifierShortcuts } from './modifierShortcuts';
import { removeDuplicateShortcuts, ShortcutGroup, shortcutModes, toElectronAccelerator } from './shortcutBindings';
import { setRecordingMute } from './systemAudio';
import { checkForUpdate } from './updates';
import type { HudAction } from './hudActions';
import { pasteIntoWindowsField, prepareWindowsPaste } from './windowsPaste';

let mainWindow: BrowserWindow | null = null;
let hudWindow: BrowserWindow | null = null;
let hudReady = false;
let hudPayload: { show: boolean; state?: { status?: string; mode?: string } } = { show: false };
let hudDisplayId: number | undefined;
let tray: Tray | null = null;
let isQuitting = false;
let quitAfterAudioRestore = false;
let shortcutEditorOpen = false;

const isDev = !app.isPackaged;

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'yapyap-store.json');
}

function syncShortcutSuspension() {
  globalShortcut.setSuspended(shortcutEditorOpen && mainWindow?.isFocused() === true);
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1140,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#ffffff',
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
    void setRecordingMute(false).catch(console.warn);
  });
  mainWindow.webContents.on('did-start-navigation', (event) => {
    if (event.isMainFrame && !event.isSameDocument) {
      shortcutEditorOpen = false;
      syncShortcutSuspension();
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
    },
  });

  hudWindow.webContents.on('did-start-loading', () => {
    hudReady = false;
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
  });
}

function updateHudWindow(): void {
  if (!hudWindow || !hudReady) return;
  if (!hudPayload.show) {
    hudWindow.hide();
    hudDisplayId = undefined;
    return;
  }

  const state = hudPayload.state;
  const display = screen.getAllDisplays().find((item) => item.id === hudDisplayId) ??
    screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  hudDisplayId = display.id;
  const { workArea } = display;
  let width = 148;
  let height = 54;
  if (state?.status === 'recording' && state.mode === 'ask') height = 94;
  if (state?.status === 'recording' && state.mode === 'translate') {
    width = 290;
    height = 215;
  }
  if (state?.status === 'error' || state?.status === 'result') {
    const answer = state.status === 'result' && state.mode === 'ask';
    width = answer ? 620 : 360;
    height = answer ? 334 : 230;
  }
  width = Math.min(width, workArea.width);
  height = Math.min(height, workArea.height - 12);
  const x = workArea.x + Math.round((workArea.width - width) / 2);
  const y = workArea.y + workArea.height - height - 12;
  const bounds = hudWindow.getBounds();
  if (bounds.width !== width || bounds.height !== height || bounds.x !== x || bounds.y !== y) {
    hudWindow.setBounds({ x, y, width, height });
  }
  hudWindow.webContents.send('hud:state', state);
  if (!hudWindow.isVisible()) hudWindow.showInactive();
}

function createTray(): void {
  try {
    const emptyPng =
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAWElEQVQ4T2NkoBAwUqifAW8AmqH4DcBpwH88BrAgGwDmwMUBiO0F4iYgdqRmAFwQ6wYgNkI2AK4JbAAzEPsCMQeRGYAWwL+Q4wAYG5nGgGYA3K+4xQEA1i4OE1h3/xAAAAAASUVORK5CYII=';
    const icon = nativeImage.createFromDataURL(`data:image/png;base64,${emptyPng}`);
    tray = new Tray(icon);
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
  } catch {
    // Tray may not be available in headless Linux
  }
}

function registerAppShortcuts(shortcuts: ShortcutGroup): boolean {
  const unique = removeDuplicateShortcuts(shortcuts, process.platform);
  globalShortcut.unregisterAll();
  // Electron requires shortcut handling to be active when adding registrations.
  globalShortcut.setSuspended(false);
  const modifierShortcuts: Parameters<typeof registerModifierShortcuts>[0] = [];

  for (const mode of shortcutModes) {
    for (const combo of unique[mode]) {
      const accel = toElectronAccelerator(combo);
      const trigger = () => mainWindow?.webContents.send('trigger-mode', mode);
      if (canHookShortcut(combo) && (!accel || combo.includes('Right Alt'))) {
        modifierShortcuts.push({ combo, trigger });
        continue;
      }
      if (!accel) continue;
      try {
        globalShortcut.register(accel, trigger);
      } catch {
        // Ignore invalid/taken accelerator
      }
    }
  }
  try {
    registerModifierShortcuts(modifierShortcuts);
    return true;
  } catch (error) {
    console.warn('Could not register modifier-only shortcuts', error);
    return false;
  } finally {
    syncShortcutSuspension();
  }
}

function pasteIntoFocusedField(): Promise<boolean> {
  if (process.platform === 'win32') return pasteIntoWindowsField(pasteWithKeyboard);

  // These commands can send the shortcut but cannot confirm insertion.
  return new Promise((resolve) => {
    if (process.platform === 'darwin') {
      exec(
        'osascript -e \'tell application "System Events" to keystroke "v" using command down\'',
        { timeout: 5000 },
        () => resolve(false)
      );
    } else {
      exec('xdotool key --clearmodifiers ctrl+v', { timeout: 5000 }, () => resolve(false));
    }
  });
}

app.whenReady().then(() => {
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
  ipcMain.handle('clipboard:copy', async (event, text: string) => {
    if (event.sender === mainWindow?.webContents) await clipboard.writeText(text);
  });

  ipcMain.on('hud:toggle', (event, payload: typeof hudPayload) => {
    if (event.sender !== mainWindow?.webContents) return;
    hudPayload = payload;
    if (payload.show && !hudWindow) createHudWindow();
    updateHudWindow();
  });

  ipcMain.on('hud:ready', (event) => {
    if (event.sender !== hudWindow?.webContents) return;
    hudReady = true;
    updateHudWindow();
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

      const clone = JSON.parse(JSON.stringify(data)) as {
        history?: Array<{ id: string; audioDataUrl?: string }>;
        [k: string]: unknown;
      };

      const activeAudioIds = new Set<string>();
      if (Array.isArray(clone.history)) {
        for (const item of clone.history) {
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

    } catch {
      // Ignore write error
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
        fields: Record<string, string>;
      }
    ) => {
      const form = new FormData();
      const buffer = Buffer.from(req.fileBase64, 'base64');
      const blob = new Blob([buffer], { type: req.mimeType });
      form.append('file', blob, req.fileName);
      for (const [k, v] of Object.entries(req.fields)) {
        form.append(k, v);
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
