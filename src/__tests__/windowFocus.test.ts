import { describe, expect, it, vi } from 'vitest';
import {
  isOwnProcessWindow,
  isWindowActuallyFocused,
  nativeWindowId,
  reconcileWindowsMinimizeFocus,
  reconcileWindowsShowFocus,
  type FocusableWindow,
  type WindowFocusDeps,
  type WindowReconcileDeps,
} from '../../electron/windowFocus';

function handle64(hwnd: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(hwnd, 0);
  return buf;
}

function handle32(hwnd: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(hwnd, 0);
  return buf;
}

function makeWindow(overrides: Partial<FocusableWindow> = {}): FocusableWindow {
  return {
    isDestroyed: () => false,
    isFocused: () => true,
    isVisible: () => true,
    isMinimized: () => false,
    getNativeWindowHandle: () => handle64(656788n),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<WindowFocusDeps> = {}): WindowFocusDeps {
  return {
    platform: 'win32',
    pid: 7472,
    win32Available: () => true,
    foregroundWindow: () => '656788',
    windowProcessId: () => 7472,
    ...overrides,
  };
}

describe('nativeWindowId', () => {
  it('decodes 64-bit and 32-bit native HWND buffers into decimal strings', () => {
    expect(nativeWindowId(handle64(656788n))).toBe('656788');
    expect(nativeWindowId(handle32(131244))).toBe('131244');
  });

  it('returns undefined for zero or undersized handles', () => {
    expect(nativeWindowId(handle64(0n))).toBeUndefined();
    expect(nativeWindowId(handle32(0))).toBeUndefined();
    expect(nativeWindowId(Buffer.alloc(2))).toBeUndefined();
  });
});

describe('isWindowActuallyFocused', () => {
  it('returns false when window is missing, destroyed, hidden, or minimized even if isFocused is stuck true', () => {
    const deps = makeDeps();
    expect(isWindowActuallyFocused(null, deps)).toBe(false);
    expect(isWindowActuallyFocused(undefined, deps)).toBe(false);
    expect(isWindowActuallyFocused(makeWindow({ isDestroyed: () => true }), deps)).toBe(false);
    expect(isWindowActuallyFocused(makeWindow({ isVisible: () => false, isFocused: () => true }), deps)).toBe(false);
    expect(isWindowActuallyFocused(makeWindow({ isMinimized: () => true, isFocused: () => true }), deps)).toBe(false);
  });

  it('returns false on Windows when isFocused is stuck true after background show but another app is foreground', () => {
    const win = makeWindow({ isFocused: () => true, getNativeWindowHandle: () => handle64(656788n) });
    const deps = makeDeps({ foregroundWindow: () => '999111' });
    expect(isWindowActuallyFocused(win, deps)).toBe(false);
  });

  it('returns false on Windows when there is no foreground window even if isFocused is true', () => {
    const win = makeWindow({ isFocused: () => true });
    expect(isWindowActuallyFocused(win, makeDeps({ foregroundWindow: () => '0' }))).toBe(false);
    expect(isWindowActuallyFocused(win, makeDeps({ foregroundWindow: () => '' }))).toBe(false);
  });

  it('returns true on Windows when the OS foreground window matches the main window HWND', () => {
    const win = makeWindow({ isFocused: () => true, getNativeWindowHandle: () => handle64(656788n) });
    const deps = makeDeps({ foregroundWindow: () => '656788' });
    expect(isWindowActuallyFocused(win, deps)).toBe(true);
  });

  it('falls back to isFocused when Win32 bindings are unavailable or on macOS/Linux', () => {
    const focused = makeWindow({ isFocused: () => true });
    const blurred = makeWindow({ isFocused: () => false });

    expect(isWindowActuallyFocused(focused, makeDeps({ win32Available: () => false }))).toBe(true);
    expect(isWindowActuallyFocused(blurred, makeDeps({ win32Available: () => false }))).toBe(false);
    expect(isWindowActuallyFocused(focused, makeDeps({ platform: 'darwin' }))).toBe(true);
    expect(isWindowActuallyFocused(blurred, makeDeps({ platform: 'linux' }))).toBe(false);
    expect(isWindowActuallyFocused(makeWindow({ isMinimized: () => true, isFocused: () => true }), makeDeps({ platform: 'darwin' }))).toBe(false);
  });
});

describe('isOwnProcessWindow', () => {
  it('identifies Windows foreground windows belonging to this process', () => {
    const deps = makeDeps({ pid: 7472, windowProcessId: (id) => (id === '12345' ? 7472 : 4200) });
    expect(isOwnProcessWindow('12345', deps)).toBe(true);
    expect(isOwnProcessWindow('99999', deps)).toBe(false);
    expect(isOwnProcessWindow('0', deps)).toBe(false);
    expect(isOwnProcessWindow(undefined, deps)).toBe(false);
  });

  it('returns false when Win32 is unavailable or on non-Windows platforms', () => {
    expect(isOwnProcessWindow('12345', makeDeps({ win32Available: () => false }))).toBe(false);
    expect(isOwnProcessWindow('12345', makeDeps({ platform: 'darwin' }))).toBe(false);
  });
});

function makeReconcileDeps(overrides: Partial<WindowReconcileDeps> = {}): WindowReconcileDeps {
  return {
    platform: 'win32',
    win32Available: () => true,
    foregroundWindow: () => '999111',
    placeWindowBehind: vi.fn(),
    deactivateWindow: vi.fn(),
    ...overrides,
  };
}

describe('reconcileWindowsShowFocus', () => {
  it('leaves the window alone when Windows granted it real foreground focus', () => {
    const win = makeWindow({ getNativeWindowHandle: () => handle64(656788n) });
    const deps = makeReconcileDeps({ foregroundWindow: () => '656788' });
    expect(reconcileWindowsShowFocus(win, deps)).toBe(false);
    expect(deps.placeWindowBehind).not.toHaveBeenCalled();
    expect(deps.deactivateWindow).not.toHaveBeenCalled();
  });

  it('moves the window behind the foreground app and clears stale focus when Windows denied foreground', () => {
    const win = makeWindow({ getNativeWindowHandle: () => handle64(656788n) });
    const deps = makeReconcileDeps({ foregroundWindow: () => '999111' });
    expect(reconcileWindowsShowFocus(win, deps)).toBe(true);
    expect(deps.placeWindowBehind).toHaveBeenCalledWith('656788', '999111');
    expect(deps.deactivateWindow).toHaveBeenCalledWith('656788');
  });

  it('still clears stale focus and drops topmost when there is no foreground window', () => {
    const win = makeWindow({ getNativeWindowHandle: () => handle64(656788n) });
    const deps = makeReconcileDeps({ foregroundWindow: () => '0' });
    expect(reconcileWindowsShowFocus(win, deps)).toBe(true);
    expect(deps.placeWindowBehind).toHaveBeenCalledWith('656788', '0');
    expect(deps.deactivateWindow).toHaveBeenCalledWith('656788');
  });

  it('is a no-op on non-Windows, when Win32 is unavailable, or when the window is destroyed/hidden', () => {
    const win = makeWindow();
    const macDeps = makeReconcileDeps({ platform: 'darwin' });
    expect(reconcileWindowsShowFocus(win, macDeps)).toBe(false);
    expect(macDeps.placeWindowBehind).not.toHaveBeenCalled();

    const noWin32 = makeReconcileDeps({ win32Available: () => false });
    expect(reconcileWindowsShowFocus(win, noWin32)).toBe(false);
    expect(noWin32.placeWindowBehind).not.toHaveBeenCalled();

    const hiddenDeps = makeReconcileDeps();
    expect(reconcileWindowsShowFocus(makeWindow({ isVisible: () => false }), hiddenDeps)).toBe(false);
    expect(reconcileWindowsShowFocus(makeWindow({ isDestroyed: () => true }), hiddenDeps)).toBe(false);
    expect(hiddenDeps.placeWindowBehind).not.toHaveBeenCalled();
  });
});

describe('reconcileWindowsMinimizeFocus', () => {
  it('clears stale focus when a minimized window is not the Windows foreground window', () => {
    const win = makeWindow({ isMinimized: () => true, isVisible: () => false, getNativeWindowHandle: () => handle64(656788n) });
    const deps = makeReconcileDeps({ foregroundWindow: () => '999111' });
    expect(reconcileWindowsMinimizeFocus(win, deps)).toBe(true);
    expect(deps.deactivateWindow).toHaveBeenCalledWith('656788');
    expect(deps.placeWindowBehind).not.toHaveBeenCalled();
  });

  it('does not deactivate when the window is still foreground or on non-Windows', () => {
    const win = makeWindow({ getNativeWindowHandle: () => handle64(656788n) });
    const fgDeps = makeReconcileDeps({ foregroundWindow: () => '656788' });
    expect(reconcileWindowsMinimizeFocus(win, fgDeps)).toBe(false);
    expect(fgDeps.deactivateWindow).not.toHaveBeenCalled();

    const linuxDeps = makeReconcileDeps({ platform: 'linux' });
    expect(reconcileWindowsMinimizeFocus(win, linuxDeps)).toBe(false);
    expect(linuxDeps.deactivateWindow).not.toHaveBeenCalled();
  });
});
