// A few Windows calls made straight to user32.dll through koffi, with no native build of our own.

// koffi ships CommonJS, but its types are marked as an ES module.
type Koffi = typeof import('koffi', { with: { 'resolution-mode': 'import' } });

type User32 = {
  GetForegroundWindow: () => number | bigint;
  GetAsyncKeyState: (key: number) => number;
  GetClipboardSequenceNumber: () => number;
};

let user32: User32 | null | undefined;

function load(): User32 | null {
  if (user32 !== undefined) return user32;
  try {
    const koffi = require('koffi') as Koffi;
    const lib = koffi.load('user32.dll');
    user32 = {
      GetForegroundWindow: lib.func('intptr_t __stdcall GetForegroundWindow()'),
      GetAsyncKeyState: lib.func('int16_t __stdcall GetAsyncKeyState(int vKey)'),
      GetClipboardSequenceNumber: lib.func('uint32_t __stdcall GetClipboardSequenceNumber()'),
    };
  } catch (error) {
    console.warn('Yap Yap could not load user32.dll', error);
    user32 = null;
  }
  return user32;
}

export const win32Available = () => process.platform === 'win32' && !!load();

/** The window in front, as a number that stays the same while that window is in front. */
export const foregroundWindow = () => String(load()?.GetForegroundWindow() ?? '');

// Shift, Ctrl, Alt, and both Windows keys.
const MODIFIERS = [0x10, 0x11, 0x12, 0x5b, 0x5c];

/** A modifier Windows sees as held, which would combine with a key Yap Yap sends. */
export const modifiersDown = () => MODIFIERS.some((key) => ((load()?.GetAsyncKeyState(key) ?? 0) & 0x8000) !== 0);

/** Changes each time anything is put on the clipboard. */
export const clipboardSequence = () => load()?.GetClipboardSequenceNumber() ?? 0;
