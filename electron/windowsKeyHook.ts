import path from 'node:path';
import { app } from 'electron';

// koffi ships CommonJS, but its types are marked as an ES module.
type Koffi = typeof import('koffi', { with: { 'resolution-mode': 'import' } });

// Yap Yap's own keyboard hook (native/windows/keyhook.cpp). Unlike uiohook it can
// swallow keys, so other apps never see Right Alt and the keys of its shortcuts.
type Library = {
  start: (callback: unknown) => number;
  stop: () => void;
  setKeys: (leads: number[], leadCount: number, chords: number[], chordCount: number) => void;
  // Registered once and never released: a call from an earlier start may still be on its way.
  callback: unknown;
};

/** Sent instead of a key when every key was released without Yap Yap seeing it. */
export const KEYS_RESET = -1;

let library: Library | undefined;
let running = false;
let onKey: ((down: boolean, code: number, time: number) => void) | undefined;

function dllPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'yapyap-keys.dll')
    : path.join(app.getAppPath(), 'native/windows/build/yapyap-keys.dll');
}

function load(): Library {
  if (library) return library;
  // Loaded here, inside the caller's try, so a missing native module falls back to uiohook.
  const koffi = require('koffi') as Koffi;
  const lib = koffi.load(dllPath());
  const KeyCallback = koffi.proto('void YapYapKeyCallback(int down, int code, unsigned int time)');
  library = {
    start: lib.func('int yk_start(YapYapKeyCallback *cb)'),
    stop: lib.func('void yk_stop()'),
    setKeys: lib.func('void yk_set_keys(const int *leads, int leadCount, const int *chords, int chordCount)'),
    callback: koffi.register((down: number, code: number, time: number) => {
      if (running) onKey?.(down !== 0, code, time);
    }, koffi.pointer(KeyCallback)),
  };
  return library;
}

/** Starts the hook; false when it cannot load or start, so the caller falls back to uiohook. */
export function startWindowsKeyHook(handler: (down: boolean, code: number, time: number) => void): boolean {
  if (running) return true;
  try {
    const lib = load();
    onKey = handler;
    running = lib.start(lib.callback) === 1;
    return running;
  } catch (error) {
    console.warn('Yap Yap could not start its key hook', error);
    return false;
  }
}

export function setWindowsSwallowedKeys({ leads, chords }: { leads: number[]; chords: number[] }): void {
  if (running) library?.setKeys(leads, leads.length, chords, chords.length);
}

export function stopWindowsKeyHook(): void {
  if (!running) return;
  running = false;
  library?.stop();
}
