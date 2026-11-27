import { foregroundWindow, win32Available, windowProcessId } from './win32';

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

const defaultDeps: WindowFocusDeps = {
  platform: process.platform,
  pid: process.pid,
  win32Available,
  foregroundWindow,
  windowProcessId,
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
