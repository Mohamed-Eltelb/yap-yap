import fs from 'node:fs';
import path from 'node:path';
import { SELECTION_LIMIT } from './selectionLimit';

// koffi ships CommonJS, but its types are marked as an ES module.
type Koffi = typeof import('koffi', { with: { 'resolution-mode': 'import' } });

/** What yapyap-text.dll read: the selection, whether it can be typed over, and the app in front. */
export interface NativeSelection {
  text: string;
  editable: boolean;
  password: boolean;
  process: string;
}

type ReadSelection = {
  async: (
    text: Buffer, capacity: number, flags: Buffer, process: Buffer, processCapacity: number,
    done: (error: unknown, length: number) => void,
  ) => void;
};

let read: ReadSelection | null | undefined;

// Installed builds keep the DLL beside the app's resources; development uses the fresh build.
function dllPath(): string | undefined {
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath, 'yapyap-text.dll'),
    path.join(__dirname, '..', 'native', 'windows', 'build', 'yapyap-text.dll'),
  ].filter((file): file is string => !!file);
  return candidates.find((file) => fs.existsSync(file));
}

function load(): ReadSelection | null {
  if (read !== undefined) return read;
  read = null;
  if (process.platform !== 'win32') return read;
  const file = dllPath();
  if (!file) return read;
  try {
    const koffi = require('koffi') as Koffi;
    const lib = koffi.load(file);
    read = lib.func('int ys_read_selection(void *text, int capacity, void *flags, void *process, int processCapacity)') as unknown as ReadSelection;
  } catch (error) {
    console.warn('Yap Yap could not load its selection reader; using PowerShell instead', error);
  }
  return read;
}

export const nativeSelectionAvailable = () => !!load();

/**
 * Reads the selection on a worker thread. Undefined when the DLL is missing or failed, so the
 * caller falls back to PowerShell. The DLL sets its own UI Automation time limits; this one only
 * guards against a call that never returns.
 */
export function readNativeSelection(timeoutMs = 4000): Promise<NativeSelection | undefined> {
  const fn = load();
  if (!fn) return Promise.resolve(undefined);
  // One character more than is kept, so a cut can be noticed.
  const capacity = SELECTION_LIMIT + 1;
  const text = Buffer.alloc(capacity * 2);
  const flags = Buffer.alloc(4);
  const name = Buffer.alloc(260 * 2);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    try {
      fn.async(text, capacity, flags, name, 260, (error, length) => {
        clearTimeout(timer);
        if (error || length < 0) return resolve(undefined);
        const flagBits = flags.readInt32LE(0);
        const processName = name.toString('utf16le').split('\0')[0];
        resolve({
          text: text.toString('utf16le', 0, length * 2),
          editable: (flagBits & 1) !== 0,
          password: (flagBits & 2) !== 0,
          process: processName,
        });
      });
    } catch {
      clearTimeout(timer);
      resolve(undefined);
    }
  });
}
