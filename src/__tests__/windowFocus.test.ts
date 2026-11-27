import { describe, expect, it } from 'vitest';
import {
  isOwnProcessWindow,
  isWindowActuallyFocused,
  nativeWindowId,
  type FocusableWindow,
  type WindowFocusDeps,
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
