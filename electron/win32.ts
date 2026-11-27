// A few Windows calls made straight to user32.dll through koffi, with no native build of our own.

// koffi ships CommonJS, but its types are marked as an ES module.
type Koffi = typeof import('koffi', { with: { 'resolution-mode': 'import' } });

type User32 = {
  GetForegroundWindow: () => number | bigint;
  GetWindowThreadProcessId: (hwnd: bigint, pid: Buffer) => number;
  GetWindowLongW: (hwnd: bigint, index: number) => number;
  SetWindowPos: (
    hwnd: bigint, insertAfter: bigint, x: number, y: number, cx: number, cy: number, flags: number,
  ) => number;
  SendMessageW: (hwnd: bigint, msg: number, wParam: number | bigint, lParam: number | bigint) => number | bigint;
  SetFocus: (hwnd: bigint) => number | bigint;
  GetAsyncKeyState: (key: number) => number;
  GetClipboardSequenceNumber: () => number;
};

let user32: User32 | null | undefined;

function load(): User32 | null {
  if (user32 !== undefined) return user32;
  if (process.platform !== 'win32') {
    user32 = null;
    return user32;
  }
  try {
    const koffi = require('koffi') as Koffi;
    const lib = koffi.load('user32.dll');
    user32 = {
      GetForegroundWindow: lib.func('intptr_t __stdcall GetForegroundWindow()'),
      GetWindowThreadProcessId: lib.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hWnd, void *lpdwProcessId)'),
      GetWindowLongW: lib.func('int32_t __stdcall GetWindowLongW(intptr_t hWnd, int nIndex)'),
      SetWindowPos: lib.func(
        'int __stdcall SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int X, int Y, int cx, int cy, uint32_t uFlags)',
      ),
      SendMessageW: lib.func(
        'intptr_t __stdcall SendMessageW(intptr_t hWnd, uint32_t Msg, uintptr_t wParam, intptr_t lParam)',
      ),
      SetFocus: lib.func('intptr_t __stdcall SetFocus(intptr_t hWnd)'),
      GetAsyncKeyState: lib.func('int16_t __stdcall GetAsyncKeyState(int vKey)'),
      GetClipboardSequenceNumber: lib.func('uint32_t __stdcall GetClipboardSequenceNumber()'),
    };
  } catch (error) {
    console.warn('Yap Yap could not load user32.dll', error);
    user32 = null;
  }
  return user32;
}

function parseHwnd(windowId: string): bigint | undefined {
  if (!/^-?\d+$/.test(windowId) || windowId === '0') return undefined;
  return BigInt(windowId);
}

export const win32Available = () => process.platform === 'win32' && !!load();

/** The window in front, as a number that stays the same while that window is in front. */
export const foregroundWindow = () => String(load()?.GetForegroundWindow() ?? '');

/** Process ID that owns the given Windows HWND, or 0 when unavailable. */
export function windowProcessId(windowId: string): number {
  const hwnd = parseHwnd(windowId);
  const api = hwnd !== undefined ? load() : null;
  if (!api || hwnd === undefined) return 0;
  const pid = Buffer.alloc(4);
  try {
    api.GetWindowThreadProcessId(hwnd, pid);
    return pid.readUInt32LE(0);
  } catch {
    return 0;
  }
}

const GWL_EXSTYLE = -20;
const WS_EX_TOPMOST = 0x00000008;
const HWND_NOTOPMOST = -2n;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const WM_ACTIVATE = 0x0006;
const WM_ACTIVATEAPP = 0x001c;
const WM_NCACTIVATE = 0x0086;

/**
 * Places `windowId` directly behind `afterWindowId` without activating it. If `afterWindowId` is
 * missing or topmost, falls back to HWND_NOTOPMOST so `windowId` is never promoted to topmost.
 */
export function placeWindowBehind(windowId: string, afterWindowId: string): boolean {
  const hwnd = parseHwnd(windowId);
  const api = hwnd !== undefined ? load() : null;
  if (!api || hwnd === undefined) return false;
  const after = parseHwnd(afterWindowId);
  try {
    const afterTopmost = after !== undefined && ((api.GetWindowLongW(after, GWL_EXSTYLE) >>> 0) & WS_EX_TOPMOST) !== 0;
    const insertAfter = after !== undefined && !afterTopmost ? after : HWND_NOTOPMOST;
    return api.SetWindowPos(hwnd, insertAfter, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE) !== 0;
  } catch {
    return false;
  }
}

/**
 * Clears Chromium/Electron's stale active and focus state on a window that does not actually own
 * Windows foreground (for example after ShowWindow was denied foreground by Windows' foreground lock).
 */
export function deactivateWindow(windowId: string): void {
  const hwnd = parseHwnd(windowId);
  const api = hwnd !== undefined ? load() : null;
  if (!api || hwnd === undefined) return;
  try {
    api.SetFocus(0n);
    api.SendMessageW(hwnd, WM_ACTIVATEAPP, 0, 0n);
    api.SendMessageW(hwnd, WM_ACTIVATE, 0, 0n);
    api.SendMessageW(hwnd, WM_NCACTIVATE, 0, 0n);
  } catch {
    // Ignore if window closed mid-call.
  }
}

// Shift, Ctrl, Alt, and both Windows keys.
const MODIFIERS = [0x10, 0x11, 0x12, 0x5b, 0x5c];

/** A modifier Windows sees as held, which would combine with a key Yap Yap sends. */
export const modifiersDown = () => MODIFIERS.some((key) => ((load()?.GetAsyncKeyState(key) ?? 0) & 0x8000) !== 0);

/** Changes each time anything is put on the clipboard. */
export const clipboardSequence = () => load()?.GetClipboardSequenceNumber() ?? 0;
