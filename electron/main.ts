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
import { canHookShortcut, keyHookAvailable, pasteWithKeyboard, registerModifierShortcuts, resetModifierShortcuts, setMenuMasking, stopModifierShortcuts, swallowsKeys } from './modifierShortcuts';
import { removeDuplicateShortcuts, ShortcutGroup, shortcutModes, toElectronAccelerator } from './shortcutBindings';
import { retargetLinuxAutostart, setLinuxAutostart } from './linuxAutostart';
import {
  launchedHiddenAtLogin,
  linuxAutostartCommand,
  loginItemSettings,
  shouldShowMainWindowOnSecondInstance,
} from './loginLaunch';
import { setRecordingMute } from './systemAudio';
import { autoUpdater, type ProgressInfo } from 'electron-updater';
import { createUpdateLogger, type UpdateLogger } from './updateLog';
import { checkForUpdate, downloadInstaller, installsUpdatesInPlace } from './updates';
import { UpdateController, type UpdateState } from './updateController';
import type { HudAction } from './hudActions';
import {
  cursorOverHud,
  hudHideDelay,
  HUD_SHRINK_DELAY_MS,
  HUD_WINDOW_SIZE,
  HudPlacer,
  hudWindowSize,
  isAskAnswerHud,
  type HudHitRect,
} from './hudBounds';
import { HudRefresher } from './hudRefresh';
import { pasteIntoWindowsField, prepareWindowsPaste } from './windowsPaste';
import { classifyZedCopy, copyPlanFor, copySelection, isExcel, isPowerPoint, type CopiedSelection } from './selectionCopy';
import { webUrl } from './webUrl';
import { freshHighlights } from './primarySelection';
import {
  nativeDiscardClipboard,
  nativeExcelCellEditor,
  nativeFocusedWindow,
  nativeInspectCopyMetadata,
  nativeRestoreClipboard,
  nativeSaveClipboard,
  nativeSelectionAvailable,
  nativeWriteClipboardRichText,
  nativeWriteClipboardText,
  readNativeRewriteField,
  sendNativeClipboardShortcut,
} from './nativeSelection';
import { markdownToClipboardHtml } from './richClipboard';
import { confirmRewrite, expectedRewrite, normalizeSelectionText, type RewritePasteResult } from './rewriteVerification';
import { clipboardSequence, foregroundWindow, modifiersDown, win32Available } from './win32';
import {
  isOwnProcessWindow,
  isWindowActuallyFocused,
  reconcileWindowsMinimizeFocus,
  reconcileWindowsShowFocus,
} from './windowFocus';
import { captureDictationContext, captureSelection, insertWaylandText, isWayland, linuxPasteTarget, linuxPrimaryStamp, readFocusedField, stopDictationContext, warmDictationContext, type SelectedText } from './dictationContext';
import { plainTextFromClipboardSnapshot, writeLinuxClipboardText } from './linuxClipboard';
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

function isMainWindowFocused(): boolean {
  return isWindowActuallyFocused(mainWindow);
}

function showMainWindow(focus = false): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  if (focus) mainWindow.focus();
  if (reconcileWindowsShowFocus(mainWindow)) syncShortcutSuspension();
}

function syncShortcutSuspension() {
  const suspended = shortcutEditorOpen && isMainWindowFocused();
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

function createMainWindow(options: { startHidden?: boolean } = {}): void {
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
  // On OS login launches, keep it tucked in the tray (falling back to showing if tray failed).
  mainWindow.once('ready-to-show', () => {
    if (options.startHidden && tray) return;
    showMainWindow();
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
  mainWindow.on('hide', syncShortcutSuspension);
  mainWindow.on('minimize', () => {
    reconcileWindowsMinimizeFocus(mainWindow);
    syncShortcutSuspension();
  });
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
  // go to the app underneath. Main-process cursor hit-testing switches this off over the HUD.
  if (process.platform !== 'linux') window.setIgnoreMouseEvents(true);

  // Only a navigation that went through replaces the page, so only then wait for it to say it
  // is ready again. Blocked ones (see will-frame-navigate) still start loading but keep the page,
  // which would then never say so, leaving the HUD hidden for good.
  window.webContents.on('did-navigate', () => {
    if (window !== hudWindow) return;
    hudReady = false;
    stopHudMouseTracking();
    hudHitRects = [];
    if (process.platform !== 'linux') applyHudIgnoreMouse(window, true, true);
    if (window.isVisible()) window.hide();
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
    hudHitRects = [];
    stopHudMouseTracking();
    clearHudTimer();
    hudPlacer.forget();
  });
  return window;
}

// The HUD window's own log, hud.log in Electron's logs folder, so a HUD that stops showing
// leaves a trail of the window replacements and the power and display events around it.
let hudLogger: UpdateLogger | undefined;
const hudLog = () => (hudLogger ??= createUpdateLogger(path.join(app.getPath('logs'), 'hud.log')));
// Logs selection/rewrite metadata only (never user text) to diagnose missed captures or pastes.
let selectionLogger: UpdateLogger | undefined;
const selectionLog = () => (selectionLogger ??= createUpdateLogger(path.join(app.getPath('logs'), 'selection.log')));

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
  hudHitRects = [];
  hudMouseIgnored = true;
  stopHudMouseTracking();
  hudDisplayId = undefined;
  hudShownStatus = undefined;
  hudPlacer.forget();
  previous?.destroy();
  hudLog().info(`HUD window ${next.id} replaced ${previous?.id}`);
}

let hudHideTimer: ReturnType<typeof setTimeout> | undefined;
let hudShrinkTimer: ReturnType<typeof setTimeout> | undefined;
/** The HUD window shows nothing (it stays on screen, letting clicks through). */
let hudEmpty = true;
/** The status the HUD window last showed, to know if a pill has to shrink out. */
let hudShownStatus: string | undefined;
let hudHitRects: HudHitRect[] = [];
let hudMouseIgnored = true;
let hudMouseTimer: ReturnType<typeof setInterval> | undefined;

function applyHudIgnoreMouse(window: BrowserWindow, ignore: boolean, force = false): void {
  if (process.platform === 'linux' || window.isDestroyed()) return;
  if (!force && ignore === hudMouseIgnored) return;
  hudMouseIgnored = ignore;
  window.setIgnoreMouseEvents(ignore);
}

function stopHudMouseTracking(): void {
  if (hudMouseTimer !== undefined) {
    clearInterval(hudMouseTimer);
    hudMouseTimer = undefined;
  }
}

function syncHudMouse(): void {
  if (!hudWindow || hudWindow.isDestroyed() || process.platform === 'linux') {
    stopHudMouseTracking();
    return;
  }
  if (hudEmpty || hudHitRects.length === 0 || !hudWindow.isVisible()) {
    applyHudIgnoreMouse(hudWindow, true);
    if (hudEmpty || hudHitRects.length === 0) stopHudMouseTracking();
    return;
  }
  const inside = cursorOverHud(screen.getCursorScreenPoint(), hudWindow.getBounds(), hudHitRects);
  applyHudIgnoreMouse(hudWindow, !inside);
}

function startHudMouseTracking(): void {
  if (process.platform === 'linux') return;
  syncHudMouse();
  if (hudMouseTimer === undefined && !hudEmpty && hudHitRects.length > 0) {
    hudMouseTimer = setInterval(syncHudMouse, 32);
  }
}

function clearHudTimer() {
  clearTimeout(hudHideTimer);
  hudHideTimer = undefined;
  clearTimeout(hudShrinkTimer);
  hudShrinkTimer = undefined;
}

const hudPlacer = new HudPlacer();

// Mapping the HUD can take keyboard focus on Wayland, even with showInactive().
let readingWaylandTarget = 0;
async function withWaylandTarget<T>(read: () => Promise<T>, keepHidden?: (result: T) => boolean): Promise<T> {
  if (!isWayland) return read();
  readingWaylandTarget++;
  const payloadBefore = hudPayload;
  let shouldKeepHidden = false;
  try {
    if (hudWindow?.isVisible()) {
      hudWindow.hide();
      // Give the compositor a moment to return window and text-input focus to the editor.
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    const result = await read();
    shouldKeepHidden = keepHidden?.(result) === true;
    return result;
  } finally {
    readingWaylandTarget--;
    if (shouldKeepHidden && hudPayload === payloadBefore) {
      hudPayload = { show: false };
    }
    updateHudWindow();
  }
}

function updateHudWindow(): void {
  if (!hudWindow || !hudReady || readingWaylandTarget) return;
  if (!hudPayload.show) {
    if (hudHideTimer) return;
    // Linux has no forwarded mouse events. Unmap its idle overlay so the editor gets clicks.
    // On Windows, hiding and re-showing the window breaks HUD button input.
    const hide = (window: BrowserWindow) => {
      window.webContents.send('hud:state', { status: 'idle', mode: 'dictate', levels: [] });
      stopHudMouseTracking();
      hudHitRects = [];
      if (process.platform === 'linux') window.hide();
      else applyHudIgnoreMouse(window, true, true);
      const previousDisplayId = hudDisplayId;
      hudEmpty = true;
      hudDisplayId = undefined;
      hudShownStatus = undefined;
      if (window === hudWindow) {
        // After the blank idle frame paints, return an expanded Answer window to the compact size.
        hudShrinkTimer = setTimeout(() => {
          hudShrinkTimer = undefined;
          if (!hudEmpty || window !== hudWindow || window.isDestroyed()) return;
          const display = screen.getAllDisplays().find((item) => item.id === previousDisplayId)
            ?? screen.getPrimaryDisplay();
          const compact = hudPlacer.place(display.workArea, hudWindowSize(display.workArea, false));
          if (compact) window.setBounds(compact);
        }, 60);
        hudRefresher.idle();
      }
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
  // Compact size for pills/notices; expand only when showing an Ask anything answer card.
  const bounds = hudPlacer.place(workArea, hudWindowSize(workArea, isAskAnswerHud(state)));
  if (bounds) hudWindow.setBounds(bounds);
  hudShownStatus = state?.status;
  hudWindow.webContents.send('hud:state', state);
  if (hudEmpty) {
    // Start letting clicks through until the renderer reports its visible HUD hit rects.
    hudEmpty = false;
    hudRefresher.busy();
    applyHudIgnoreMouse(hudWindow, true, true);
    hudWindow.webContents.send('hud:shown');
  }
  if (!hudWindow.isVisible()) hudWindow.showInactive();
  if (hudHitRects.length > 0) startHudMouseTracking();
}

function createTray(): void {
  const trayIcon = process.platform === 'win32' ? 'tray.ico' : 'tray.png';

  try {
    tray = new Tray(path.join(iconsPath, trayIcon));
    tray.setToolTip('Yap Yap — A little yap goes a long way');
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open Yap Yap',
        click: () => showMainWindow(true),
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
    tray.on('double-click', () => showMainWindow(true));
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
const freshHighlight = freshHighlights();

async function syncLinuxPrimaryAfterClipboardWrite(): Promise<void> {
  if (process.platform !== 'linux' || isWayland) return;
  const [text, stamp] = await Promise.all([
    clipboard.selection?.readText().catch(() => undefined),
    linuxPrimaryStamp().catch(() => undefined),
  ]);
  freshHighlight({ text, stamp });
}

async function writeClipboardText(text: string): Promise<void> {
  if (isWayland) {
    if (!isMainWindowFocused() && await writeLinuxClipboardText(text, true)) return;
    await clipboard.writeText(text);
    return;
  }
  if (process.platform === 'linux') {
    if (await writeLinuxClipboardText(text, false)) return;
    await clipboard.writeText(text);
    await syncLinuxPrimaryAfterClipboardWrite();
    return;
  }
  await clipboard.writeText(text);
}

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
  if (!items.length) {
    clipboard.clear();
    return;
  }
  if (process.platform === 'linux' && !isWayland) {
    const plain = await plainTextFromClipboardSnapshot(previous);
    if (plain !== undefined && await writeLinuxClipboardText(plain, false)) return;
  }
  await clipboard.write(items);
  if (process.platform === 'linux' && !isWayland) await syncLinuxPrimaryAfterClipboardWrite();
}

async function readZedCopyMetadata(): Promise<string | null | undefined> {
  const format = 'electron application/osclipboard;format="GPUI internal metadata"';
  try {
    if (!await clipboard.has(format)) return null;
    const items = await clipboard.read();
    const item = items.find(({ types }) => types.includes(format));
    const data = await item?.getType(format);
    if (data instanceof Blob && data.size <= 32 * 1024) {
      return new TextDecoder('utf-16le').decode(await data.arrayBuffer()).split('\0', 1)[0];
    }
  } catch {
    // The clipboard can be busy while another app publishes its formats.
  }
}

interface ClipboardBackup {
  nativeToken?: bigint;
  snapshot?: ClipboardSnapshot;
}

async function saveClipboardBackup(): Promise<ClipboardBackup> {
  if (nativeSelectionAvailable()) {
    const token = nativeSaveClipboard();
    if (token !== 0n) return { nativeToken: token };
  }
  return { snapshot: await snapshotClipboard() };
}

async function restoreClipboardBackup(
  backup: ClipboardBackup, expectedText: string, expectedSequence?: number,
): Promise<void> {
  // Only put the user's clipboard back while it still holds what Yap Yap put there.
  const untouched = await clipboard.readText() === expectedText
    && (expectedSequence === undefined || clipboardSequence() === expectedSequence);
  if (backup.nativeToken !== undefined) {
    if (untouched) nativeRestoreClipboard(backup.nativeToken, expectedSequence ?? 0);
    else nativeDiscardClipboard(backup.nativeToken);
    return;
  }
  if (backup.snapshot && untouched) await restoreClipboard(backup.snapshot);
}

function discardClipboardBackup(backup: ClipboardBackup): void {
  if (backup.nativeToken !== undefined) nativeDiscardClipboard(backup.nativeToken);
}

async function copyWindowsSelection(
  window: string,
  processName: string,
  excelEditor: bigint,
  focus: bigint,
  options: { allowCtrlCFallback?: boolean; inTerminal?: boolean } = {},
  maxWaitMs?: number,
): Promise<CopiedSelection | undefined> {
  if (excelEditor && !isExcel(processName)) return;
  // A PowerPoint Copy of a slide or shape is told apart from a text highlight only by the DLL.
  if (isPowerPoint(processName) && !nativeSelectionAvailable()) return;
  const plan = copyPlanFor(processName, excelEditor !== 0n, options.allowCtrlCFallback, options.inTerminal);
  if (!plan) return;

  const zed = /^zed(?:\.exe)?$/i.test(processName);
  let readOnly = false;
  let unusedBackup: ClipboardBackup | undefined;
  const text = await copySelection(window, {
    foregroundWindow,
    modifiersDown,
    clipboardSequence,
    sendCopy: (keys, sequence) => sendNativeClipboardShortcut(window, sequence, keys, excelEditor, focus),
    readCopied: () => clipboard.readText(),
    readCopiedKind: async () => {
      const nativeKind = nativeInspectCopyMetadata();
      if (zed) {
        const kind = nativeKind === 'selection' || nativeKind === 'implicit-line'
          ? nativeKind
          : classifyZedCopy(await readZedCopyMetadata());
        // The terminal also uses Zed.exe. Its Copy supplies plain text without editor metadata.
        readOnly = kind !== 'selection';
        return kind;
      }
      return nativeKind ?? 'unknown';
    },
    async saveClipboard() {
      const backup = await saveClipboardBackup();
      unusedBackup = backup;
      return async (copied, copiedSequence) => {
        unusedBackup = undefined;
        await restoreClipboardBackup(backup, copied, copiedSequence);
      };
    },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }, plan, maxWaitMs);
  if (text === undefined && unusedBackup) discardClipboardBackup(unusedBackup);
  if (text !== undefined) return { text, readOnly };
}

async function captureWindowsSelection(
  window: string, allowCopy: boolean, original?: SelectedText,
): Promise<SelectedText | undefined> {
  const excelEditor = nativeExcelCellEditor(window);
  const focus = nativeFocusedWindow(window);
  const excelCellEditor = excelEditor ? String(excelEditor) : undefined;
  const focusedWindowId = focus ? String(focus) : undefined;
  // The rewrite must land in the same control the text was read from.
  if (original && (original.excelCellEditor !== excelCellEditor
    || (original.focusedWindowId && original.focusedWindowId !== focusedWindowId)
    || (original.viaCopy && !focus))) return;

  const copy = allowCopy
    ? (name: string, options?: { allowCtrlCFallback?: boolean; inTerminal?: boolean }) =>
        copyWindowsSelection(window, name, excelEditor, focus, options, original ? 500 : undefined)
    : undefined;
  const selection = await captureSelection(copy, !!original, excelEditor !== 0n);
  if (!selection) {
    selectionLog().info(`capture missed (native=${nativeSelectionAvailable()}, allowCopy=${allowCopy}, rewrite=${!!original}, focus=${focus !== 0n})`);
    return;
  }
  if (foregroundWindow() !== window || nativeExcelCellEditor(window) !== excelEditor
    || (focus && nativeFocusedWindow(window) !== focus)) {
    selectionLog().info(`capture dropped: target changed (process=${selection.process ?? '?'}, viaCopy=${!!selection.viaCopy})`);
    return;
  }
  return {
    ...selection,
    // Without a focused control to check before pasting, a copied selection is never typed over.
    ...(selection.viaCopy && !focus ? { editable: false } : {}),
    windowId: window,
    focusedWindowId,
    excelCellEditor,
  };
}

async function waitForModifiersRelease(window: string, maxWaitMs: number): Promise<boolean> {
  for (let waited = 0; modifiersDown(); waited += 25) {
    if (waited >= maxWaitMs || foregroundWindow() !== window) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return foregroundWindow() === window;
}

async function pasteWindowsRewrite(
  selection: SelectedText, text: string, keepOnClipboard: boolean, allowCopy: boolean,
): Promise<RewritePasteResult> {
  const window = selection.windowId;
  if (!window || window === '0' || !win32Available() || foregroundWindow() !== window || selection.truncated) {
    selectionLog().info(`rewrite not-sent: precheck failed (truncated=${!!selection.truncated}, fgMatch=${foregroundWindow() === window})`);
    return 'not-sent';
  }

  if (!await waitForModifiersRelease(window, 600)) {
    selectionLog().info(`rewrite not-sent: modifiers held or window changed (process=${selection.process ?? '?'})`);
    return 'not-sent';
  }

  // Re-reads the selection, and checks the Excel cell editor and focused control are unchanged.
  const now = await captureWindowsSelection(window, selection.viaCopy === true && allowCopy, selection);
  if (!now || now.truncated
    || normalizeSelectionText(now.text) !== normalizeSelectionText(selection.text)
    || now.editable !== true
    || foregroundWindow() !== window) {
    selectionLog().info(`rewrite not-sent: verification mismatch (process=${selection.process ?? '?'}, reread=${!!now}, editable=${now?.editable})`);
    return 'not-sent';
  }
  const excelEditor = now.excelCellEditor ? BigInt(now.excelCellEditor) : 0n;
  const focus = now.focusedWindowId ? BigInt(now.focusedWindowId) : 0n;

  const [backup, field] = await Promise.all([
    saveClipboardBackup(),
    readNativeRewriteField(window, true, 180),
  ]);
  if (!await waitForModifiersRelease(window, 250)) {
    discardClipboardBackup(backup);
    return 'not-sent';
  }
  const expected = field && expectedRewrite(field, now.text, text);
  let sequence: number | undefined;
  let sent = false;
  const rich = markdownToClipboardHtml(text);
  try {
    const writtenSeq = nativeSelectionAvailable()
      ? (rich
          ? nativeWriteClipboardRichText(text, rich.cfHtml, !keepOnClipboard)
          : nativeWriteClipboardText(text, !keepOnClipboard))
      : 0;
    if (writtenSeq) {
      sequence = writtenSeq;
    } else {
      if (rich) {
        await clipboard.write([new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([rich.html], { type: 'text/html' }),
        })]);
      } else {
        await clipboard.writeText(text);
      }
      sequence = clipboardSequence();
    }
    if (await clipboard.readText() !== text) return 'not-sent';
    sent = sendNativeClipboardShortcut(window, sequence, 'ctrl+v', excelEditor, focus);
    if (!sent && foregroundWindow() === window && !modifiersDown() && await clipboard.readText() === text) {
      sequence = clipboardSequence();
      sent = sendNativeClipboardShortcut(window, sequence, 'ctrl+v', excelEditor, focus);
    }
  } finally {
    if (sequence !== undefined && (!sent || !keepOnClipboard)) {
      restoreAfterPaste(backup, text, sent ? 600 : 0, sequence);
    } else {
      discardClipboardBackup(backup);
    }
  }
  if (!sent) return 'not-sent';
  if (field && expected !== undefined && await confirmRewrite(field, expected, (timeoutMs) =>
    readNativeRewriteField(window, false, timeoutMs))) return 'confirmed';
  return 'unverified';
}

function restoreAfterPaste(backup: ClipboardBackup, text: string, delay: number, sequence?: number): void {
  setTimeout(() => {
    void restoreClipboardBackup(backup, text, sequence).catch(console.warn);
  }, delay);
}

function pasteIntoFocusedField(): Promise<boolean> {
  if (process.platform === 'win32') {
    return pasteIntoWindowsField(pasteWithKeyboard);
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
        retargetLinuxAutostart(app.getPath('appData'), linuxAutostartCommand(file));
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
app.on('second-instance', (_event, argv) => {
  if (!shouldShowMainWindowOnSecondInstance(argv)) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (app.isReady()) createMainWindow();
    return;
  }
  showMainWindow(true);
});

app.whenReady().then(() => {
  if (isDev) app.dock?.setIcon(appIconPath);
  warmDictationContext();
  createTray();
  const startHidden = launchedHiddenAtLogin({
    platform: process.platform,
    argv: process.argv,
    loginItem: process.platform === 'darwin' ? app.getLoginItemSettings() : undefined,
  });
  createMainWindow({ startHidden });
  createHudWindow();
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
    // Only installed builds can start independently of the development server.
    if (!app.isPackaged) return;
    if (process.platform === 'linux') {
      setLinuxAutostart(app.getPath('appData'), enabled, linuxAutostartCommand(process.env.APPIMAGE || process.execPath));
    } else {
      app.setLoginItemSettings(loginItemSettings(process.platform, enabled));
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

  async function pasteViaClipboard(text: string, keepOnClipboard: boolean): Promise<boolean> {
    // On Linux, the target check reads the accessibility tree, so take the clipboard snapshot meanwhile.
    const [target, previous] = await Promise.all([
      process.platform === 'linux' ? linuxPasteTarget() : undefined,
      keepOnClipboard ? undefined : saveClipboardBackup(),
    ]);
    if (target === 'blocked') {
      if (previous) discardClipboardBackup(previous);
      return false;
    }
    const sequence = process.platform === 'win32' && nativeSelectionAvailable()
      ? (nativeWriteClipboardText(text, !keepOnClipboard) || (await clipboard.writeText(text), clipboardSequence()))
      : (await writeClipboardText(text), undefined);
    try {
      const sent = await pasteIntoFocusedField();
      return sent && target !== 'unconfirmed';
    } finally {
      // The paste goes through the clipboard; put back what the user had there once the target has read it.
      if (previous) restoreAfterPaste(previous, text, 600, sequence);
    }
  }

  ipcMain.handle('selection:replace', async (
    event, selection: SelectedText, text: string, keepOnClipboard?: boolean, allowCopy?: boolean,
  ): Promise<RewritePasteResult> => {
    if (event.sender !== mainWindow?.webContents || isMainWindowFocused()
      || !selection || typeof text !== 'string' || !text) return 'not-sent';
    if (isWayland) {
      // Keep the HUD hidden across both the selection re-read and insertion so the editor
      // and its text-input/IBus focus are never disturbed twice.
      const inserted = await withWaylandTarget(async () => {
        const now = await captureSelection();
        if (now?.text !== selection.text) return false;
        return insertWaylandText(text);
      }, (ok) => ok);
      if (keepOnClipboard === true) await writeClipboardText(text).catch(console.warn);
      return inserted ? 'confirmed' : 'not-sent';
    }
    if (process.platform === 'linux') {
      const now = await captureSelection();
      if (now?.text !== selection.text) return 'not-sent';
      return (await pasteViaClipboard(text, keepOnClipboard === true)) ? 'unverified' : 'not-sent';
    }
    if (process.platform !== 'win32' || isOwnProcessWindow(foregroundWindow())) return 'not-sent';
    return pasteWindowsRewrite(selection, text, keepOnClipboard === true, allowCopy === true);
  });
  ipcMain.handle('clipboard:paste', async (event, text: string, keepOnClipboard?: boolean) => {
    if (event.sender !== mainWindow?.webContents || typeof text !== 'string' || !text) return false;
    if (isWayland) {
      const inserted = await withWaylandTarget(async () => {
        if (!mainWindow || isMainWindowFocused()) return false;
        return insertWaylandText(text);
      }, (ok) => ok);
      if (keepOnClipboard === true) await writeClipboardText(text).catch(console.warn);
      return inserted;
    }
    return pasteViaClipboard(text, keepOnClipboard === true);
  });
  ipcMain.on('clipboard:prepare-paste', (event) => {
    if (event.sender === mainWindow?.webContents && process.platform === 'win32') prepareWindowsPaste();
  });
  ipcMain.handle('dictation:capture-context', (event) => {
    if (event.sender !== mainWindow?.webContents || isMainWindowFocused()) return;
    if (win32Available() && isOwnProcessWindow(foregroundWindow())) return;
    return withWaylandTarget(captureDictationContext);
  });
  // Text selected in another app, for Ask anything. Text selected in Yap Yap's own window is not read.
  ipcMain.handle('selection:capture', async (event, allowCopy?: boolean) => {
    if (event.sender !== mainWindow?.webContents) return;
    if (isMainWindowFocused()) {
      selectionLog().info('capture skipped: mainWindow is focused');
      return;
    }
    if (isWayland) return withWaylandTarget(() => captureSelection());
    if (process.platform === 'linux' && allowCopy === true) {
      // Read at every Ask, even when accessibility finds the selection, so it is never reused later.
      const highlight = Promise.all([clipboard.selection?.readText(), linuxPrimaryStamp()])
        .then(([text, stamp]) => freshHighlight({ text, stamp }), () => undefined);
      return captureSelection(() => highlight);
    }
    if (!win32Available()) return captureSelection();
    const windowId = foregroundWindow();
    if (!windowId || windowId === '0') {
      selectionLog().info('capture skipped: no foreground window');
      return;
    }
    if (isOwnProcessWindow(windowId)) {
      selectionLog().info('capture skipped: own process is foreground');
      return;
    }
    return captureWindowsSelection(windowId, allowCopy === true);
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
    if (event.sender === mainWindow?.webContents) await writeClipboardText(text);
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
  powerMonitor.on('resume', () => {
    resetModifierShortcuts();
    refreshHudOn('resume')();
  });
  powerMonitor.on('unlock-screen', () => {
    resetModifierShortcuts();
    refreshHudOn('unlock-screen')();
  });
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
    applyHudIgnoreMouse(hudWindow, ignore === true);
  });

  ipcMain.on('hud:hit-rects', (event, rawRects: unknown) => {
    if (event.sender !== hudWindow?.webContents || process.platform === 'linux') return;
    const next: HudHitRect[] = [];
    if (Array.isArray(rawRects)) {
      for (const item of rawRects.slice(0, 8)) {
        if (!item || typeof item !== 'object') continue;
        const { left, top, right, bottom } = item as Record<string, unknown>;
        if (typeof left === 'number' && typeof top === 'number'
          && typeof right === 'number' && typeof bottom === 'number'
          && Number.isFinite(left) && Number.isFinite(top)
          && Number.isFinite(right) && Number.isFinite(bottom)
          && right > left && bottom > top) {
          next.push({ left, top, right, bottom });
        }
      }
    }
    hudHitRects = next;
    if (hudHitRects.length > 0 && !hudEmpty) {
      startHudMouseTracking();
    } else {
      stopHudMouseTracking();
      applyHudIgnoreMouse(hudWindow, true);
    }
  });

  ipcMain.on('hud:action', async (event, action: HudAction) => {
    if (event.sender !== hudWindow?.webContents) return;
    if (action.type === 'copy' && typeof action.text === 'string') {
      await writeClipboardText(action.text).catch(console.warn);
      return;
    }
    if (action.type === 'edit-targets') {
      showMainWindow(true);
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
  stopHudMouseTracking();
  clearHudTimer();
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
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  } else {
    showMainWindow(true);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
