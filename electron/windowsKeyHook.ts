import path from 'node:path';
import { app } from 'electron';

// koffi ships CommonJS, but its types are marked as an ES module.
type Koffi = typeof import('koffi', { with: { 'resolution-mode': 'import' } });
const koffi = require('koffi') as Koffi;

// Yap Yap's own keyboard hook (native/windows/keyhook.cpp). Unlike uiohook it can
// swallow keys, so other apps never see Right Alt and the keys of its shortcuts.
type Hook = {
  start: (callback: unknown) => number;
  stop: () => void;
  setKeys: (leads: number[], leadCount: number, chords: number[], chordCount: number) => void;
  callback: unknown;
};

let hook: Hook | undefined;
let KeyCallback: ReturnType<Koffi['proto']> | undefined;

function dllPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'yapyap-keys.dll')
    : path.join(app.getAppPath(), 'native/windows/build/yapyap-keys.dll');
}

/** Starts the hook; false when it cannot load or start, so the caller falls back to uiohook. */
export function startWindowsKeyHook(onKey: (down: boolean, code: number, time: number) => void): boolean {
  if (hook) return true;
  try {
    const lib = koffi.load(dllPath());
    KeyCallback ??= koffi.proto('void YapYapKeyCallback(int down, int code, unsigned int time)');
    const callback = koffi.register((down: number, code: number, time: number) => onKey(down !== 0, code, time), koffi.pointer(KeyCallback));
    const next: Hook = {
      start: lib.func('int yk_start(YapYapKeyCallback *cb)'),
      stop: lib.func('void yk_stop()'),
      setKeys: lib.func('void yk_set_keys(const int *leads, int leadCount, const int *chords, int chordCount)'),
      callback,
    };
    if (next.start(callback) !== 1) {
      koffi.unregister(callback);
      return false;
    }
    hook = next;
    return true;
  } catch (error) {
    console.warn('Yap Yap could not start its key hook', error);
    return false;
  }
}

export function setWindowsSwallowedKeys({ leads, chords }: { leads: number[]; chords: number[] }): void {
  hook?.setKeys(leads, leads.length, chords, chords.length);
}

export function stopWindowsKeyHook(): void {
  if (!hook) return;
  hook.stop();
  koffi.unregister(hook.callback as never);
  hook = undefined;
}
