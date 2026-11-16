import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import koffi from 'koffi';

const KEYUP = 0x80;
const INJECTED = 0x10;
const EXTENDED = 0x01;
const ALT = 0x38;
const SHIFT = 0x36;
const SPACE = 0x39;
const Q = 0x10;

describe.runIf(process.platform === 'win32')('Native key hook', () => {
  let testEvent: (down: number, scan: number, flags: number) => number;
  let testCode: (scan: number, flags: number) => number;
  let desktopSwitch: () => void;
  let start: (cb: unknown) => number;
  let stop: () => void;
  let Callback: unknown;
  let reset: () => void;
  let setKeys: (leads: number[], leadCount: number, chords: number[], chordCount: number) => void;

  beforeAll(() => {
    const lib = koffi.load(path.resolve('native/windows/build/yapyap-keys.dll'));
    testEvent = lib.func('int yk_test_event(int down, int scan, int flags)');
    reset = lib.func('void yk_test_reset()');
    setKeys = lib.func('void yk_set_keys(const int *leads, int leadCount, const int *chords, int chordCount)');
    testCode = lib.func('int yk_test_code(int scan, int flags)');
    desktopSwitch = lib.func('void yk_test_desktop_switch()');
    Callback = koffi.proto('void TestKeyCallback(int down, int code, unsigned int time)');
    start = lib.func('int yk_start(TestKeyCallback *cb)');
    stop = lib.func('void yk_stop()');
  });

  beforeEach(() => {
    reset();
    setKeys([3640], 1, [54, 57], 2);
  });

  const altDown = () => testEvent(1, ALT, EXTENDED);
  const altUp = () => testEvent(0, ALT, EXTENDED | KEYUP);

  it('swallows Right Alt down and up', () => {
    expect(altDown()).toBe(1);
    expect(altUp()).toBe(1);
  });

  it('swallows repeats of a held lead', () => {
    expect(altDown()).toBe(1);
    expect(altDown()).toBe(1);
  });

  it('swallows the AltGr fake Ctrl', () => {
    expect(testEvent(1, 0x21d, 0)).toBe(1);
    expect(testEvent(0, 0x21d, KEYUP)).toBe(1);
  });

  it('swallows chord keys only while Right Alt is held', () => {
    expect(testEvent(1, SPACE, 0)).toBe(0);
    expect(testEvent(0, SPACE, KEYUP)).toBe(0);
    altDown();
    expect(testEvent(1, SPACE, 0)).toBe(1);
  });

  it('swallows the up of a key whose down was swallowed', () => {
    altDown();
    expect(testEvent(1, SHIFT, 0)).toBe(1);
    altUp();
    expect(testEvent(0, SHIFT, KEYUP)).toBe(1);
  });

  it('swallows Right Shift as Windows reports it', () => {
    altDown();
    expect(testEvent(1, SHIFT, EXTENDED)).toBe(1);
    expect(testEvent(0, SHIFT, EXTENDED | KEYUP)).toBe(1);
  });

  it('passes other keys while a lead is held', () => {
    altDown();
    expect(testEvent(1, Q, 0)).toBe(0);
    expect(testEvent(0, Q, KEYUP)).toBe(0);
  });

  it('never swallows injected keys', () => {
    expect(testEvent(1, ALT, EXTENDED | INJECTED)).toBe(0);
  });

  it('swallows nothing when no keys are set', () => {
    setKeys([], 0, [], 0);
    expect(altDown()).toBe(0);
    expect(testEvent(1, 0x21d, 0)).toBe(0);
  });

  it('swallows repeats of a chord key after Right Alt is released', () => {
    altDown();
    expect(testEvent(1, SHIFT, 0)).toBe(1);
    altUp();
    expect(testEvent(1, SHIFT, 0)).toBe(1);
    expect(testEvent(0, SHIFT, KEYUP)).toBe(1);
  });

  it('passes the up of a key whose down passed', () => {
    setKeys([], 0, [], 0);
    expect(altDown()).toBe(0);
    expect(testEvent(1, 0x21d, 0)).toBe(0);
    setKeys([3640], 1, [54, 57], 2);
    expect(altUp()).toBe(0);
    expect(testEvent(0, 0x21d, KEYUP)).toBe(0);
  });

  it('stops swallowing after the secure desktop takes the keyboard', () => {
    altDown();
    desktopSwitch();
    expect(testEvent(1, SPACE, 0)).toBe(0);
    expect(altUp()).toBe(0);
  });

  it('reports arrow keys and NumLock with uiohook codes', () => {
    expect(testCode(0x48, EXTENDED)).toBe(0xe048);
    expect(testCode(0x45, EXTENDED)).toBe(0x45);
    expect(testCode(0x38, EXTENDED)).toBe(0xe38);
    expect(testCode(0x21d, 0)).toBe(29);
    // Windows marks Right Shift as extended; uiohook does not.
    expect(testCode(SHIFT, EXTENDED)).toBe(54);
  });

  it('starts and stops repeatedly', () => {
    const callback = koffi.register(() => undefined, koffi.pointer(Callback as never));
    try {
      for (let round = 0; round < 3; round++) {
        expect(start(callback)).toBe(1);
        stop();
      }
    } finally {
      koffi.unregister(callback);
    }
  });
});
