import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  powerMonitor,
  screen,
  shell,
  Tray,
} from 'electron';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { canHookShortcut, copyWithKeyboard, keyHookAvailable, pasteWithKeyboard, registerModifierShortcuts, setMenuMasking, stopModifierShortcuts, swallowsKeys } from './modifierShortcuts';
import { removeDuplicateShortcuts, ShortcutGroup, shortcutModes, toElectronAccelerator } from './shortcutBindings';
import { retargetLinuxAutostart, setLinuxAutostart } from './linuxAutostart';
import { setRecordingMute } from './systemAudio';
import { autoUpdater, type ProgressInfo } from 'electron-updater';
import { createUpdateLogger, type UpdateLogger } from './updateLog';
import { checkForUpdate, downloadInstaller, installsUpdatesInPlace } from './updates';
import { UpdateController, type UpdateState } from './updateController';
import type { HudAction } from './hudActions';
import { hudHideDelay, HUD_SHRINK_DELAY_MS, HUD_WINDOW_SIZE, HudPlacer, hudWindowSize } from './hudBounds';
import { HudRefresher } from './hudRefresh';
import { pasteIntoWindowsField, prepareWindowsPaste } from './windowsPaste';
import { copyPlanFor, copySelection } from './selectionCopy';
import { webUrl } from './webUrl';
import { freshHighlights } from './primarySelection';
import { clipboardSequence, foregroundWindow, modifiersDown, win32Available } from './win32';
import { captureDictationContext, captureSelection, linuxPasteTarget, linuxPrimaryStamp, readFocusedField, stopDictationContext, warmDictationContext, type SelectedText } from './dictationContext';
import { watchPasteCorrections } from './pasteCorrections';
import { appExecutables, readOtherApps, type OtherAppData } from './otherApps';
import { isAudioId, markSavedAudio } from './audioStore';

let mainWindow: BrowserWindow | null = null;
let hudWindow: BrowserWindow | null = null;
let hudReady = false;
let hudPayload: {
  show: boolean;
  state?: { status?: string; mode?: string; paused?: boolean; busyNotice?: boolean; shortcutList?: unknown[] };
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

function fromMainFrame(event: Electron.IpcMainInvokeEvent): boolean {
  return event.sender === mainWindow?.webContents && event.senderFrame === event.sender.mainFrame;
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
  mainWindow.webContents.on('will-frame-navigate', (event) => event.preventDefault());
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

/** Creates the HUD window and makes it the current one. */
function createHudWindow(): void {
  hudWindow = newHudWindow();
  hudLog().info(`HUD window ${hudWindow.id} created`);
}

/**
 * A HUD window. Its events only change the HUD state while it is the current window, so a
 * replacement can load beside the old one (see hudRefresh.ts).
 */
function newHudWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...HUD_WINDOW_SIZE,
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

  const id = window.id;
  window.webContents.on('will-frame-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // The window is larger than the HUD it draws; clicks on the transparent part
  // go to the app underneath. The HUD page turns this off while hovered.
  if (process.platform !== 'linux') window.setIgnoreMouseEvents(true, { forward: true });

  // Only a navigation that went through replaces the page, so only then wait for it to say it
  // is ready again. Blocked ones (see will-frame-navigate) still start loading but keep the page,
  // which would then never say so, leaving the HUD hidden for good.
  window.webContents.on('did-navigate', () => {
    if (window !== hudWindow) return;
    hudReady = false;
    if (process.platform !== 'linux') window.setIgnoreMouseEvents(true, { forward: true });
    window.hide();
    hudEmpty = true;
    hudLog().info(`HUD window ${id} page loading`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    hudLog().warn(`HUD window ${id} page gone: ${details.reason}`);
    if (window === hudReplacement) {
      hudReplacement = null;
      window.destroy();
      return;
    }
    if (window !== hudWindow) return;
    hudReady = false;
    window.hide();
    hudEmpty = true;
  });
  if (isDev) {
    void window.loadURL('http://localhost:5173/#/hud');
  } else {
    void window.loadFile(path.join(__dirname, '../dist/index.html'), {
      hash: '/hud',
    });
  }

  window.on('closed', () => {
    if (window === hudReplacement) hudReplacement = null;
    if (window !== hudWindow) return;
    hudReady = false;
    hudWindow = null;
    hudEmpty = true;
    clearHudTimer();
    hudPlacer.forget();
  });
  return window;
}

// The HUD window's own log, hud.log in Electron's logs folder, so a HUD that stops showing
// leaves a trail of the window replacements and the power and display events around it.
let hudLogger: UpdateLogger | undefined;
const hudLog = () => (hudLogger ??= createUpdateLogger(path.join(app.getPath('logs'), 'hud.log')));

/** A new HUD window loading in the background, to replace the current one once ready. */
let hudReplacement: BrowserWindow | null = null;

function hudIsIdle(): boolean {
  return Boolean(hudWindow && hudReady && hudEmpty && !hudHideTimer && !hudPayload.show);
}

const hudRefresher = new HudRefresher({
  isIdle: hudIsIdle,
  refresh(reason) {
    if (hudReplacement) return;
    hudReplacement = newHudWindow();
    hudLog().info(`HUD window ${hudReplacement.id} loading to replace ${hudWindow?.id} (${reason})`);
  },
});

/** The replacement's page is ready: swap it in, unless the HUD started showing meanwhile. */
function swapInHudReplacement(): void {
  const next = hudReplacement;
  if (!next) return;
  hudReplacement = null;
  if (!hudIsIdle()) {
    hudLog().info(`HUD window ${next.id} dropped: the HUD is showing`);
    next.destroy();
    hudRefresher.request('retry');
    return;
  }
  const previous = hudWindow;
  hudWindow = next;
  hudReady = true;
  hudEmpty = true;
  hudDisplayId = undefined;
  hudShownStatus = undefined;
  hudPlacer.forget();
  previous?.destroy();
  hudLog().info(`HUD window ${next.id} replaced ${previous?.id}`);
}

let hudHideTimer: ReturnType<typeof setTimeout> | undefined;
/** The HUD window shows nothing (it stays on screen, letting clicks through). */
let hudEmpty = true;
/** The status the HUD window last showed, to know if a pill has to shrink out. */
let hudShownStatus: string | undefined;

function clearHudTimer() {
  clearTimeout(hudHideTimer);
  hudHideTimer = undefined;
}

const hudPlacer = new HudPlacer();

function updateHudWindow(): void {
  if (!hudWindow || !hudReady) return;
  if (!hudPayload.show) {
    if (hudHideTimer) return;
    // Linux has no forwarded mouse events. Unmap its idle overlay so the editor gets clicks.
    // On Windows, hiding and re-showing the window breaks HUD button input.
    const hide = (window: BrowserWindow) => {
      window.webContents.send('hud:state', { status: 'idle', mode: 'dictate', levels: [] });
      if (process.platform === 'linux') window.hide();
      else window.setIgnoreMouseEvents(true, { forward: true });
      hudEmpty = true;
      hudDisplayId = undefined;
      hudShownStatus = undefined;
      if (window === hudWindow) hudRefresher.idle();
    };
    if (hudEmpty) return;
    if (!hudWindow.isVisible() || hudHideDelay(hudShownStatus) === 0) {
      hide(hudWindow);
      return;
    }
    // Let the page shrink its pill out before the window goes.
    hudWindow.webContents.send('hud:state', { status: 'idle', mode: 'dictate', levels: [] });
    const window = hudWindow;
    hudHideTimer = setTimeout(() => {
      hudHideTimer = undefined;
      if (!window.isDestroyed()) hide(window);
    }, HUD_SHRINK_DELAY_MS);
    return;
  }
  clearHudTimer();

  const state = hudPayload.state;
  const display = screen.getAllDisplays().find((item) => item.id === hudDisplayId) ??
    screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  hudDisplayId = display.id;
  const { workArea } = display;
  // One size for every screen: the window only moves when the display changes.
  const bounds = hudPlacer.place(workArea, hudWindowSize(workArea));
  if (bounds) hudWindow.setBounds(bounds);
  hudShownStatus = state?.status;
  hudWindow.webContents.send('hud:state', state);
  if (hudEmpty) {
    // Start letting clicks through and have the page ask again when hovered.
    hudEmpty = false;
    hudRefresher.busy();
    if (process.platform !== 'linux') hudWindow.setIgnoreMouseEvents(true, { forward: true });
    hudWindow.webContents.send('hud:shown');
  }
  if (!hudWindow.isVisible()) hudWindow.showInactive();
}

function createTray(): void {
  const trayIcon = process.platform === 'win32' ? 'tray.ico' : 'tray.png';

  try {
    tray = new Tray(path.join(iconsPath, trayIcon));
    tray.setToolTip('Yap Yap — A little yap goes a long way');
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
      if (keyHookAvailable && canHookShortcut(combo) && (!accel || combo.includes('Right Alt'))) {
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
      onTogglePause: () => mainWindow?.webContents.send('hud:action', {
        type: hudPayload.state?.paused ? 'resume' : 'pause',
      } satisfies HudAction),
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
    // Without the hook (Linux with no X server), the renderer handles these shortcuts while Yap Yap is focused.
    return keyHookAvailable;
  } catch (error) {
    console.warn('Could not register modifier-only shortcuts', error);
    return false;
  } finally {
    syncShortcutSuspension();
    syncEscapeCancel();
  }
}

type ClipboardSnapshot = Array<Record<string, Blob | Electron.ClipboardBookmark>>;

// Payloads are read out now, since the items returned by read() follow the live clipboard.
async function snapshotClipboard(): Promise<ClipboardSnapshot> {
  try {
    const items = await clipboard.read();
    return await Promise.all(items.map(async (item) => {
      const entries = await Promise.all(item.types.map(async (type) => [type, await item.getType(type).catch(() => undefined)] as const));
      return Object.fromEntries(entries.filter((entry): entry is readonly [string, Blob | Electron.ClipboardBookmark] => entry[1] !== undefined));
    }));
  } catch {
    return [];
  }
}

async function restoreClipboard(previous: ClipboardSnapshot): Promise<void> {
  const items = previous.filter((item) => Object.keys(item).length).map((item) => new ClipboardItem(item));
  if (items.length) await clipboard.write(items);
  else clipboard.clear();
}

function copyWindowsSelection(
  window: string, processName: string, active: () => boolean = () => true, maxWaitMs?: number,
): Promise<string | undefined> {
  const plan = copyPlanFor(processName);
  return plan ? copySelection(window, {
    foregroundWindow: () => active() ? foregroundWindow() : undefined,
    modifiersDown,
    clipboardSequence,
    sendCopy: copyWithKeyboard,
    readCopied: () => clipboard.readText(),
    async saveClipboard() {
      const previous = await snapshotClipboard();
      return async (copied) => {
        if (await clipboard.readText() === copied) await restoreClipboard(previous);
      };
    },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }, plan, maxWaitMs) : Promise.resolve(undefined);
}

async function pasteWindowsRewrite(
  selection: SelectedText, text: string, keepOnClipboard: boolean, allowCopy: boolean,
): Promise<boolean> {
  const window = selection.windowId;
  if (!window || window === '0' || !win32Available() || foregroundWindow() !== window || selection.truncated) return false;

  let previous: ClipboardSnapshot | undefined;
  let wrote = false;
  let sent = false;
  try {
    return await pasteIntoWindowsField(async (active) => {
      if (!active() || foregroundWindow() !== window) return false;
      previous = await snapshotClipboard();
      if (!active() || foregroundWindow() !== window) return false;
      const copy = selection.viaCopy && allowCopy
        ? (name: string) => copyWindowsSelection(window, name, active, 500)
        : undefined;
      const now = await captureSelection(copy);
      if (!now || now.truncated || now.text !== selection.text || (now.viaCopy !== true && now.editable !== true)
        || !active() || foregroundWindow() !== window || modifiersDown()) return false;
      await clipboard.writeText(text);
      wrote = true;
      if (!active() || foregroundWindow() !== window || modifiersDown()) return false;
      pasteWithKeyboard();
      sent = true;
      return true;
    }, selection.viaCopy === true);
  } finally {
    if (wrote && previous && (!sent || !keepOnClipboard)) restoreAfterPaste(previous, text, sent ? 600 : 0);
  }
}

function restoreAfterPaste(previous: ClipboardSnapshot, text: string, delay: number): void {
  setTimeout(() => {
    void clipboard.readText()
      .then((current) => current === text ? restoreClipboard(previous) : undefined)
      .catch(console.warn);
  }, delay);
}

function pasteIntoFocusedField(): Promise<boolean> {
  if (process.platform === 'win32') {
    return pasteIntoWindowsField(() => {
      pasteWithKeyboard();
      return true;
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

/** The other app's own icon, read from its installed program. Undefined when it can't be read. */
async function installedAppIcon(id: OtherAppData['app']): Promise<string | undefined> {
  for (const file of appExecutables(id)) {
    if (!fs.existsSync(file)) continue;
    try {
      const icon = await app.getFileIcon(file, { size: 'normal' });
      if (!icon.isEmpty()) return icon.toDataURL();
    } catch {
      // Try the next place it may be installed.
    }
  }
  return undefined;
}

const skippedUpdatePath = () => path.join(app.getPath('userData'), 'skipped-update.txt');

// Settings → About can't show why an update failed or repeated, so updates keep their own log,
// updates.log in Electron's logs folder (under the app data folder; ~/Library/Logs on a Mac).
let updateLogger: UpdateLogger | undefined;
const updateLog = () => (updateLogger ??= createUpdateLogger(path.join(app.getPath('logs'), 'updates.log')));

let updaterConfigured = false;
function inPlaceUpdater() {
  if (!updaterConfigured) {
    updaterConfigured = true;
    autoUpdater.logger = updateLog();
    // The user approves each download; an approved update not installed yet goes in on quit.
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.disableWebInstaller = true;
    // Failures reach the caller through the rejected promise. Without a listener, 'error' would crash the app.
    autoUpdater.on('error', () => undefined);
    autoUpdater.on('appimage-filename-updated', (file) => {
      try {
        retargetLinuxAutostart(app.getPath('appData'), [file]);
      } catch (error) {
        console.warn(error);
      }
    });
  }
  return autoUpdater;
}

function setTaskbarProgress(state: UpdateState) {
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  window.setProgressBar(state.status === 'downloading' ? state.percent / 100 : -1);
}

let lastLoggedUpdateStatus: UpdateState['status'] | undefined;
const updates = new UpdateController({
  currentVersion: app.getVersion(),
  inPlace: app.isPackaged && installsUpdatesInPlace(),
  async checkInPlace() {
    const result = await inPlaceUpdater().checkForUpdates();
    return result?.isUpdateAvailable ? result.updateInfo.version : undefined;
  },
  async downloadInPlace(onPercent) {
    const updater = inPlaceUpdater();
    const onProgress = (progress: ProgressInfo) => onPercent(progress.percent);
    updater.on('download-progress', onProgress);
    try {
      await updater.downloadUpdate();
    } finally {
      updater.off('download-progress', onProgress);
    }
  },
  installInPlace() {
    // Let the windows close instead of hiding to the tray, so the installer can replace the app.
    isQuitting = true;
    setImmediate(() => inPlaceUpdater().quitAndInstall(true, true));
  },
  checkRelease: () => checkForUpdate(app.getVersion()),
  downloadInstaller: (installer, onFraction) => downloadInstaller(installer, app.getPath('downloads'), onFraction),
  revealFile: file => shell.showItemInFolder(file),
  openUrl: url => void shell.openExternal(url),
  readSkipped: () => fs.promises.readFile(skippedUpdatePath(), 'utf8').catch(() => ''),
  writeSkipped: version => fs.promises.writeFile(skippedUpdatePath(), version),
  onChange(state) {
    // Progress ticks would flood the log; each status change is enough to follow an update.
    if (state.status !== lastLoggedUpdateStatus) {
      lastLoggedUpdateStatus = state.status;
      const { status, ...details } = state;
      updateLog().info(`Update state: ${status} ${JSON.stringify(details)}`);
    }
    setTaskbarProgress(state);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:state', state);
  },
});

// One installed Yap Yap at a time. A second launch brings the running window forward instead of
// registering the shortcuts and checking for updates a second time. (Dev runs skip the lock so
// `npm run dev` still starts while the installed app is open.)
if (app.isPackaged && !app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (app.isReady()) createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(() => {
  if (isDev) app.dock?.setIcon(appIconPath);
  warmDictationContext();
  createMainWindow();
  createHudWindow();
  createTray();
  if (app.isPackaged) void updates.check(true);

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
  ipcMain.handle('app:set-login-item', (event, enabled: boolean) => {
    if (!fromMainFrame(event) || typeof enabled !== 'boolean') return;
    if (process.platform === 'linux') {
      // Only installed builds can start independently of the development server.
      if (app.isPackaged) setLinuxAutostart(app.getPath('appData'), enabled, [process.env.APPIMAGE || process.execPath]);
    } else {
      app.setLoginItemSettings({ openAtLogin: enabled });
    }
  });

  ipcMain.handle('audio:set-mute', (event, muted: boolean) =>
    event.sender === mainWindow?.webContents ? setRecordingMute(muted) : undefined);
  ipcMain.handle('update:get', (event) => fromMainFrame(event) ? updates.state : undefined);
  ipcMain.handle('update:check', (event) => fromMainFrame(event) ? updates.check() : undefined);
  ipcMain.handle('update:download', (event) => fromMainFrame(event) ? updates.download() : undefined);
  ipcMain.handle('update:install', (event) => fromMainFrame(event) ? updates.install() : undefined);
  ipcMain.handle('update:dismiss', (event) => fromMainFrame(event) ? updates.dismiss() : undefined);

  ipcMain.handle('shortcuts:update', (_e, shortcuts) => {
    return registerAppShortcuts(shortcuts);
  });

  ipcMain.on('shortcuts:editor', (event, open: boolean) => {
    if (event.sender !== mainWindow?.webContents) return;
    shortcutEditorOpen = open;
    syncShortcutSuspension();
  });

  ipcMain.handle('clipboard:paste', async (
    event, text: string, keepOnClipboard?: boolean, selection?: SelectedText, allowCopy?: boolean,
  ) => {
    if (event.sender !== mainWindow?.webContents || typeof text !== 'string' || !text) return false;
    if (selection) {
      return process.platform === 'win32' && !mainWindow.isFocused()
        && pasteWindowsRewrite(selection, text, keepOnClipboard === true, allowCopy === true);
    }
    // On Linux, the target check reads the accessibility tree, so take the clipboard snapshot meanwhile.
    const [target, previous] = await Promise.all([
      process.platform === 'linux' ? linuxPasteTarget() : undefined,
      keepOnClipboard === true ? undefined : snapshotClipboard(),
    ]);
    if (target === 'page') return false;
    await clipboard.writeText(text);
    try {
      const sent = await pasteIntoFocusedField();
      return sent && target !== 'unconfirmed';
    } finally {
      // The paste goes through the clipboard; put back what the user had there once the target has read it.
      if (previous) restoreAfterPaste(previous, text, 600);
    }
  });
  ipcMain.on('clipboard:prepare-paste', (event) => {
    if (event.sender === mainWindow?.webContents && process.platform === 'win32') prepareWindowsPaste();
  });
  ipcMain.handle('dictation:capture-context', (event) => {
    if (event.sender === mainWindow?.webContents && !mainWindow.isFocused()) return captureDictationContext();
  });
  // Text selected in another app, for Ask anything. Text selected in Yap Yap's own window is not read.
  const freshHighlight = freshHighlights();
  ipcMain.handle('selection:capture', async (event, allowCopy?: boolean) => {
    if (event.sender !== mainWindow?.webContents || mainWindow.isFocused()) return;
    if (process.platform === 'linux' && allowCopy === true) {
      // Read at every Ask, even when accessibility finds the selection, so it is never reused later.
      const highlight = Promise.all([clipboard.selection?.readText(), linuxPrimaryStamp()])
        .then(([text, stamp]) => freshHighlight({ text, stamp }), () => undefined);
      return captureSelection(() => highlight);
    }
    if (!win32Available()) return captureSelection();
    const windowId = foregroundWindow();
    if (!windowId || windowId === '0') return;
    const selection = await captureSelection(allowCopy === true ? (name) => copyWindowsSelection(windowId, name) : undefined);
    if (selection && foregroundWindow() === windowId) return { ...selection, windowId };
  });
  // A website the user asked Ask anything to open. Only web addresses: see webUrl.
  ipcMain.handle('ask:open-url', async (event, address: unknown) => {
    const url = event.sender === mainWindow?.webContents ? webUrl(address) : undefined;
    if (!url) return false;
    try {
      await shell.openExternal(url);
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle('dictation:watch-corrections', (event, text: string) =>
    event.sender === mainWindow?.webContents && typeof text === 'string' && text.trim()
      ? watchPasteCorrections(text, readFocusedField)
      : { words: [] });
  // Reads only the other apps' fixed data folders; the renderer never passes a path.
  ipcMain.handle('import:other-apps', async (event): Promise<OtherAppData[]> => {
    if (event.sender !== mainWindow?.webContents) return [];
    return Promise.all(readOtherApps(app.getPath('appData')).map(async (data) => ({ ...data, icon: await installedAppIcon(data.app) })));
  });
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
    if (hudReplacement && event.sender === hudReplacement.webContents) {
      swapInHudReplacement();
      return;
    }
    if (event.sender !== hudWindow?.webContents) return;
    hudReady = true;
    updateHudWindow();
    // Starts the idle wait for the first window.
    if (hudIsIdle()) hudRefresher.idle();
  });

  // Events that can leave the HUD window drawing nothing on screen (see hudRefresh.ts).
  const refreshHudOn = (reason: string) => () => {
    hudLog().info(`HUD: ${reason}`);
    hudRefresher.request(reason);
  };
  powerMonitor.on('resume', refreshHudOn('resume'));
  powerMonitor.on('unlock-screen', refreshHudOn('unlock-screen'));
  screen.on('display-added', refreshHudOn('display-added'));
  screen.on('display-removed', refreshHudOn('display-removed'));
  screen.on('display-metrics-changed', (_event, _display, changed) => {
    hudLog().info(`HUD: display-metrics-changed ${changed.join(',')}`);
    hudRefresher.request('display-metrics-changed');
  });
  app.on('child-process-gone', (_event, details) => {
    if (details.type !== 'GPU') return;
    hudLog().warn(`HUD: GPU process gone (${details.reason})`);
    hudRefresher.request('gpu-process-gone');
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

  ipcMain.handle('store:load', (event) => {
    if (!fromMainFrame(event)) return null;
    try {
      const p = getStorePath();
      if (!fs.existsSync(p)) return null;
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as {
        history?: Array<{ id: string; audioDataUrl?: string }>;
        [k: string]: unknown;
      };
      const audioDir = path.join(app.getPath('userData'), 'audio');
      // Recordings stay on disk until a dictation is played, downloaded or retried.
      if (Array.isArray(parsed.history) && fs.existsSync(audioDir)) {
        markSavedAudio(parsed.history, new Set(fs.readdirSync(audioDir)));
      }
      return parsed;
    } catch {
      return null;
    }
  });

  ipcMain.handle('store:load-audio', async (event, id: unknown) => {
    if (!fromMainFrame(event) || !isAudioId(id)) return null;
    try {
      return await fs.promises.readFile(path.join(app.getPath('userData'), 'audio', `${id}.txt`), 'utf8');
    } catch {
      return null;
    }
  });

  ipcMain.handle('store:save', (event, data: Record<string, unknown>) => {
    if (!fromMainFrame(event)) return false;
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
          if (!isAudioId(item.id)) continue;
          // Audio already on disk arrives as a marker instead of the recording.
          if (item.audioSaved) activeAudioIds.add(`${item.id}.txt`);
          delete item.audioSaved;
          if (item.audioDataUrl) {
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

  // Like api:request, but sends the reply to the window piece by piece while it arrives, so the app
  // can react to a streamed reply (such as a web search starting) before it is complete.
  ipcMain.handle(
    'api:stream',
    async (
      e,
      req: { id: string; url: string; method: string; headers: Record<string, string>; bodyText?: string }
    ) => {
      const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.bodyText });
      let text = '';
      if (res.body) {
        const decoder = new TextDecoder();
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          const piece = decoder.decode(chunk, { stream: true });
          text += piece;
          if (!e.sender.isDestroyed()) e.sender.send('api:stream-chunk', req.id, piece);
        }
        text += decoder.decode();
      }
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
