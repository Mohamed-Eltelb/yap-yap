import fs from 'node:fs';
import path from 'node:path';
import { SELECTION_LIMIT } from './selectionLimit';
import type { RewriteField } from './rewriteVerification';
import type { CopiedTextKind, CopyKeys } from './selectionCopy';

// koffi ships CommonJS, but its types are marked as an ES module.
type Koffi = typeof import('koffi', { with: { 'resolution-mode': 'import' } });

/** What yapyap-text.dll read: the selection, whether it can be typed over, and the app in front. */
export interface NativeSelection {
  text: string;
  editable: boolean;
  password: boolean;
  writableField?: boolean;
  readOnlyDocument?: boolean;
  inTerminal?: boolean;
  uiaOpaque?: boolean;
  process: string;
}

type ReadSelection = {
  async: (
    text: Buffer, capacity: number, flags: Buffer, process: Buffer, processCapacity: number,
    fast: number, done: (error: unknown, length: number) => void,
  ) => void;
};

type SendShortcut = (
  window: bigint, sequence: number, key: number, withShift: number, excelEditor: bigint, focusedWindow: bigint,
) => number;
type WindowProbe = (window: bigint) => number | bigint;
type WindowTitle = (window: bigint, title: Buffer, capacity: number) => number;
type InspectCopyMetadata = () => number;
type ClipboardSave = () => number | bigint;
type ClipboardWriteText = (text: Buffer, length: number, excludeFromHistory: number) => number;
type ClipboardRestore = (token: bigint, expectedSequence: number) => number;
type ClipboardDiscard = (token: bigint) => void;

type ReadRewriteField = {
  async: (
    window: bigint, text: Buffer, capacity: number, id: Buffer, idCapacity: number, info: Buffer,
    includeSelection: number, done: (error: unknown, length: number) => void,
  ) => void;
};

let read: ReadSelection | null | undefined;
let sendShortcut: SendShortcut | undefined;
let excelCellEditor: WindowProbe | undefined;
let focusedWindow: WindowProbe | undefined;
let windowTitle: WindowTitle | undefined;
let inspectCopyMetadata: InspectCopyMetadata | undefined;
let clipboardSave: ClipboardSave | undefined;
let clipboardWriteText: ClipboardWriteText | undefined;
let clipboardRestore: ClipboardRestore | undefined;
let clipboardDiscard: ClipboardDiscard | undefined;
let readRewriteField: ReadRewriteField | undefined;

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
    sendShortcut = lib.func(
      'int ys_send_clipboard_shortcut(intptr_t window, uint32_t sequence, uint16_t key, int withShift, intptr_t excelEditor, intptr_t focusedWindow)',
    ) as SendShortcut;
    excelCellEditor = lib.func('intptr_t ys_excel_cell_editor(intptr_t window)') as WindowProbe;
    focusedWindow = lib.func('intptr_t ys_focused_window(intptr_t window)') as WindowProbe;
    windowTitle = lib.func('int ys_window_title(intptr_t window, void *title, int capacity)') as WindowTitle;
    inspectCopyMetadata = lib.func('int ys_inspect_copy_metadata()') as InspectCopyMetadata;
    clipboardSave = lib.func('uint64_t ys_clipboard_save()') as ClipboardSave;
    clipboardWriteText = lib.func('uint32_t ys_clipboard_write_text(void *text, int length, int excludeFromHistory)') as ClipboardWriteText;
    clipboardRestore = lib.func('int ys_clipboard_restore(uint64_t token, uint32_t expectedSequence)') as ClipboardRestore;
    clipboardDiscard = lib.func('void ys_clipboard_discard(uint64_t token)') as ClipboardDiscard;
    readRewriteField = lib.func(
      'int ys_read_rewrite_field(intptr_t window, void *text, int capacity, void *id, int idCapacity, void *info, int includeSelection)',
    ) as unknown as ReadRewriteField;
    read = lib.func('int ys_read_selection(void *text, int capacity, void *flags, void *process, int processCapacity, int fast)') as unknown as ReadSelection;
  } catch (error) {
    console.warn('Yap Yap could not load its selection reader; using PowerShell instead', error);
  }
  return read;
}

export const nativeSelectionAvailable = () => !!load();

export function nativeExcelCellEditor(window: string): bigint {
  if (!load() || !excelCellEditor || !/^[0-9]+$/.test(window)) return 0n;
  return BigInt(excelCellEditor(BigInt(window)));
}

export function nativeFocusedWindow(window: string): bigint {
  if (!load() || !focusedWindow || !/^[0-9]+$/.test(window)) return 0n;
  return BigInt(focusedWindow(BigInt(window)));
}

export function nativeWindowTitle(window: string): string {
  if (!load() || !windowTitle || !/^[0-9]+$/.test(window)) return '';
  const buf = Buffer.alloc(512 * 2);
  const length = windowTitle(BigInt(window), buf, 512);
  return length > 0 ? buf.toString('utf16le', 0, Math.min(length, 511) * 2) : '';
}

export function nativeInspectCopyMetadata(): CopiedTextKind {
  if (!load() || !inspectCopyMetadata) return 'unknown';
  const code = inspectCopyMetadata();
  if (code === 1) return 'selection';
  if (code === 2) return 'implicit-line';
  if (code === 3) return 'object';
  return 'plain';
}

export function nativeSaveClipboard(): bigint {
  if (!load() || !clipboardSave) return 0n;
  return BigInt(clipboardSave());
}

export function nativeWriteClipboardText(text: string, excludeFromHistory: boolean): number {
  if (!load() || !clipboardWriteText) return 0;
  const buf = Buffer.from(`${text}\0`, 'utf16le');
  return clipboardWriteText(buf, text.length, excludeFromHistory ? 1 : 0);
}

export function nativeRestoreClipboard(token: bigint, expectedSequence: number): boolean {
  if (!token || !load() || !clipboardRestore) return false;
  return clipboardRestore(token, expectedSequence) === 1;
}

export function nativeDiscardClipboard(token: bigint): void {
  if (!token || !load() || !clipboardDiscard) return;
  clipboardDiscard(token);
}

export function sendNativeClipboardShortcut(
  window: string, sequence: number, key: CopyKeys | 'ctrl+v', excelEditor = 0n, focus = 0n,
): boolean {
  if (!load() || !sendShortcut || !/^[0-9]+$/.test(window)) return false;
  const spec = {
    'ctrl+c': { vk: 0x43, shift: 0 },
    'ctrl+shift+c': { vk: 0x43, shift: 1 },
    'ctrl+insert': { vk: 0x2d, shift: 0 },
    'ctrl+v': { vk: 0x56, shift: 0 },
  }[key];
  return sendShortcut(BigInt(window), sequence, spec.vk, spec.shift, excelEditor, focus) === 1;
}

/**
 * Reads the selection on a worker thread. Undefined when the DLL is missing or failed, so the
 * caller falls back to PowerShell. The DLL sets its own UI Automation time limits; this one only
 * guards against a call that never returns.
 */
export function readNativeSelection(timeoutMs = 4000, fast = false): Promise<NativeSelection | undefined> {
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
      fn.async(text, capacity, flags, name, 260, fast ? 1 : 0, (error, length) => {
        clearTimeout(timer);
        if (error || length < 0) return resolve(undefined);
        const flagBits = flags.readInt32LE(0);
        const processName = name.toString('utf16le').split('\0')[0];
        resolve({
          text: text.toString('utf16le', 0, length * 2),
          editable: (flagBits & 1) !== 0,
          password: (flagBits & 2) !== 0,
          writableField: flagBits & 4 ? true : flagBits & 8 ? false : undefined,
          inTerminal: (flagBits & 16) !== 0,
          uiaOpaque: (flagBits & 32) !== 0,
          readOnlyDocument: (flagBits & 64) !== 0,
          process: processName,
        });
      });
    } catch {
      clearTimeout(timer);
      resolve(undefined);
    }
  });
}

/** A bounded UI Automation read of the foreground field. Used only to confirm a rewrite. */
export function readNativeRewriteField(window: string, includeSelection: boolean, timeoutMs: number): Promise<RewriteField | undefined> {
  if (!load() || !readRewriteField || !/^[0-9]+$/.test(window)) return Promise.resolve(undefined);
  const fn = readRewriteField;
  const capacity = 64 * 1024 + 1;
  const idCapacity = 64;
  const text = Buffer.alloc(capacity * 2);
  const id = Buffer.alloc(idCapacity * 4);
  const info = Buffer.alloc(8);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    try {
      fn.async(BigInt(window), text, capacity, id, idCapacity, info, Number(includeSelection), (error, length) => {
        clearTimeout(timer);
        if (error || length < 0 || length >= capacity) return resolve(undefined);
        const idLength = info.readInt32LE(0);
        if (idLength < 1 || idLength > idCapacity) return resolve(undefined);
        resolve({
          id: id.toString('hex', 0, idLength * 4),
          text: text.toString('utf16le', 0, length * 2),
          selectionStart: info.readInt32LE(4),
        });
      });
    } catch {
      clearTimeout(timer);
      resolve(undefined);
    }
  });
}
