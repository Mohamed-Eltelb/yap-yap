import { deactivateWindow, foregroundWindow, placeWindowBehind, win32Available, windowProcessId } from './win32';

export interface FocusableWindow {
  isDestroyed(): boolean;
  isFocused(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
  getNativeWindowHandle(): Buffer;
}

export interface WindowFocusDeps {
  platform: NodeJS.Platform;
  pid: number;
  win32Available: () => boolean;
  foregroundWindow: () => string;
  windowProcessId: (windowId: string) => number;
}

export interface WindowReconcileDeps {
  platform: NodeJS.Platform;
  win32Available: () => boolean;
  foregroundWindow: () => string;
  placeWindowBehind: (windowId: string, afterWindowId: string) => boolean | void;
  deactivateWindow: (windowId: string) => void;
}

const defaultDeps: WindowFocusDeps = {
  platform: process.platform,
  pid: process.pid,
  win32Available,
  foregroundWindow,
  windowProcessId,
};

const defaultReconcileDeps: WindowReconcileDeps = {
  platform: process.platform,
  win32Available,
  foregroundWindow,
  placeWindowBehind,
  deactivateWindow,
};

/** Reads the OS window handle (HWND on Windows) in the same decimal format as foregroundWindow(). */
export function nativeWindowId(handle: Buffer): string | undefined {
  if (handle.length >= 8) {
    const id = handle.readBigInt64LE(0);
    return id !== 0n ? String(id) : undefined;
  }
  if (handle.length >= 4) {
    const id = handle.readInt32LE(0);
    return id !== 0 ? String(id) : undefined;
  }
  return undefined;
}

/**
 * Whether `win` genuinely has OS foreground focus.
 *
 * On Windows, Electron's `BrowserWindow.isFocused()` delegates to Chromium's
 * `HWNDMessageHandler::IsActive()`, which checks the per-thread `GetActiveWindow()` rather than
 * the global `GetForegroundWindow()`. When a window calls `show()` while another app holds the
 * foreground lock (common at startup) or after `minimize()`, `isFocused()` can stay `true`
 * indefinitely even while the user is working in another app.
 */
export function isWindowActuallyFocused(
  win: FocusableWindow | null | undefined,
  deps: WindowFocusDeps = defaultDeps,
): boolean {
  if (!win || win.isDestroyed()) return false;
  if (!win.isVisible() || win.isMinimized()) return false;
  if (deps.platform === 'win32' && deps.win32Available()) {
    const fg = deps.foregroundWindow();
    if (!fg || fg === '0') return false;
    const id = nativeWindowId(win.getNativeWindowHandle());
    if (id) return fg === id;
  }
  return win.isFocused();
}

/**
 * Whether a Windows HWND belongs to Yap Yap's own process (such as `mainWindow`, a native modal
 * dialog it opened, or an undocked DevTools window).
 */
export function isOwnProcessWindow(
  windowId: string | undefined,
  deps: Pick<WindowFocusDeps, 'platform' | 'pid' | 'win32Available' | 'windowProcessId'> = defaultDeps,
): boolean {
  if (deps.platform !== 'win32' || !deps.win32Available() || !windowId || windowId === '0') return false;
  const fgPid = deps.windowProcessId(windowId);
  return fgPid !== 0 && fgPid === deps.pid;
}

/**
 * Reconciles Z-order and activation right after `win.show()` on Windows.
 *
 * Electron's `NativeWindowViews::Show()` calls Chromium's `HWNDMessageHandler::Activate()`, which
 * runs `SetWindowPos(hwnd, HWND_TOP)` followed by `SetForegroundWindow(hwnd)`. When Windows'
 * foreground lock rejects `SetForegroundWindow`, the window stays trapped visually above the real
 * foreground window (so clicking that window outside Yap Yap never raises it) and stuck thinking
 * it is focused. Placing `win` behind the real foreground window and sending inactive messages
 * restores normal Windows behavior.
 */
export function reconcileWindowsShowFocus(
  win: FocusableWindow | null | undefined,
  deps: WindowReconcileDeps = defaultReconcileDeps,
): boolean {
  if (deps.platform !== 'win32' || !deps.win32Available()) return false;
  if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return false;
  const id = nativeWindowId(win.getNativeWindowHandle());
  if (!id) return false;
  const fg = deps.foregroundWindow();
  if (fg === id) return false;
  deps.placeWindowBehind(id, fg);
  deps.deactivateWindow(id);
  return true;
}

/** Clears stale Chromium active state after minimizing a window that does not own Windows foreground. */
export function reconcileWindowsMinimizeFocus(
  win: FocusableWindow | null | undefined,
  deps: WindowReconcileDeps = defaultReconcileDeps,
): boolean {
  if (deps.platform !== 'win32' || !deps.win32Available()) return false;
  if (!win || win.isDestroyed()) return false;
  const id = nativeWindowId(win.getNativeWindowHandle());
  if (!id) return false;
  if (deps.foregroundWindow() === id) return false;
  deps.deactivateWindow(id);
  return true;
}
