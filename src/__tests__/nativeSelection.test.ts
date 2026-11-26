import fs from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const koffi = require('koffi') as { load: (file: string) => { func: (signature: string) => unknown } };

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

type FakeExports = Record<string, unknown>;

function makeFakeLib(exportsMap: FakeExports) {
  return {
    func: vi.fn((signature: string) => {
      const match = signature.match(/\b(ys_[a-z0-9_]+)\s*\(/);
      const name = match?.[1] ?? signature;
      if (!Object.hasOwn(exportsMap, name)) {
        throw new Error(`Cannot find function '${name}'`);
      }
      return exportsMap[name];
    }),
  };
}

describe('nativeSelection loader and wrappers', () => {
  beforeEach(() => {
    vi.resetModules();
    setPlatform('win32');
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(process, 'platform', originalPlatform);
  });

  it('keeps ys_read_selection and later exports working when a middle optional export is missing', async () => {
    const readAsync = vi.fn((
      text: Buffer, _cap: number, flags: Buffer, proc: Buffer, _procCap: number,
      fast: number, timeoutMs: number, done: (err: unknown, len: number) => void,
    ) => {
      expect(fast).toBe(1);
      expect(timeoutMs).toBe(1200);
      text.write('hello', 0, 'utf16le');
      flags.writeInt32LE(1 | 4, 0);
      proc.write('notepad\0', 0, 'utf16le');
      done(null, 5);
    });
    const restore = vi.fn(() => 1);
    const lib = makeFakeLib({
      ys_read_selection: { async: readAsync },
      // Intentionally omit ys_clipboard_write_rich_text & ys_inspect_copy_metadata,
      // while keeping ys_clipboard_restore (which is bound AFTER them).
      ys_clipboard_restore: restore,
    });
    vi.spyOn(koffi, 'load').mockReturnValue(lib as never);

    const mod = await import('../../electron/nativeSelection');
    expect(mod.nativeSelectionAvailable()).toBe(true);
    await expect(mod.readNativeSelection(1200, true)).resolves.toEqual({
      text: 'hello',
      editable: true,
      password: false,
      writableField: true,
      inTerminal: false,
      uiaOpaque: false,
      process: 'notepad',
    });

    // Missing optional exports degrade safely, AND exports bound after them still work.
    expect(mod.nativeInspectCopyMetadata()).toBeUndefined();
    expect(mod.nativeWriteClipboardRichText('hello', '<html>', true)).toBe(0);
    expect(mod.nativeFocusedWindow('1234')).toBe(0n);
    expect(mod.sendNativeClipboardShortcut('1234', 1, 'ctrl+v')).toBe(false);
    expect(mod.nativeRestoreClipboard(5n, 9)).toBe(true);
    expect(restore).toHaveBeenCalledWith(5n, 9);
    await expect(mod.readNativeRewriteField('1234', true, 500)).resolves.toBeUndefined();
  });

  it('retries failed DLL loads only after the 30 second cooldown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const lib = makeFakeLib({
      ys_read_selection: { async: vi.fn() },
    });
    const loadSpy = vi.spyOn(koffi, 'load')
      .mockImplementationOnce(() => { throw new Error('transient load failure'); })
      .mockReturnValue(lib as never);

    const mod = await import('../../electron/nativeSelection');

    expect(mod.nativeSelectionAvailable()).toBe(false);
    expect(loadSpy).toHaveBeenCalledTimes(1);

    // Still inside the 30s cooldown: should not retry yet.
    vi.advanceTimersByTime(29_000);
    expect(mod.nativeSelectionAvailable()).toBe(false);
    expect(loadSpy).toHaveBeenCalledTimes(1);

    // Past the 30s cooldown: retries and succeeds.
    vi.advanceTimersByTime(2_000);
    expect(mod.nativeSelectionAvailable()).toBe(true);
    expect(loadSpy).toHaveBeenCalledTimes(2);
  });

  it('maps ys_inspect_copy_metadata codes including 0 as unknown', async () => {
    let code = 0;
    const lib = makeFakeLib({
      ys_read_selection: { async: vi.fn() },
      ys_inspect_copy_metadata: () => code,
    });
    vi.spyOn(koffi, 'load').mockReturnValue(lib as never);

    const mod = await import('../../electron/nativeSelection');
    code = 0;
    expect(mod.nativeInspectCopyMetadata()).toBe('unknown');
    code = 1;
    expect(mod.nativeInspectCopyMetadata()).toBe('selection');
    code = 2;
    expect(mod.nativeInspectCopyMetadata()).toBe('implicit-line');
    code = 3;
    expect(mod.nativeInspectCopyMetadata()).toBe('object');
    code = 99;
    expect(mod.nativeInspectCopyMetadata()).toBe('unknown');
  });

  it('decodes all selection flags and guards against hung native reads', async () => {
    vi.useFakeTimers();
    let behavior: 'flags' | 'error' | 'hang' = 'flags';
    const readAsync = vi.fn((
      text: Buffer, _cap: number, flags: Buffer, proc: Buffer, _procCap: number,
      _fast: number, _timeoutMs: number, done: (err: unknown, len: number) => void,
    ) => {
      if (behavior === 'hang') return;
      if (behavior === 'error') return done(null, -1);
      text.write('term', 0, 'utf16le');
      // password(2) | not-writable(8) | inTerminal(16) | uiaOpaque(32)
      flags.writeInt32LE(2 | 8 | 16 | 32, 0);
      proc.write('WindowsTerminal\0', 0, 'utf16le');
      done(null, 4);
    });
    vi.spyOn(koffi, 'load').mockReturnValue(makeFakeLib({
      ys_read_selection: { async: readAsync },
    }) as never);

    const mod = await import('../../electron/nativeSelection');

    await expect(mod.readNativeSelection(2500, false)).resolves.toEqual({
      text: 'term',
      editable: false,
      password: true,
      writableField: false,
      inTerminal: true,
      uiaOpaque: true,
      process: 'WindowsTerminal',
    });
    expect(readAsync.mock.calls[0][5]).toBe(0);
    expect(readAsync.mock.calls[0][6]).toBe(2500);

    behavior = 'error';
    await expect(mod.readNativeSelection(1000, false)).resolves.toBeUndefined();

    behavior = 'hang';
    const pending = mod.readNativeSelection(1000, true);
    vi.advanceTimersByTime(1500);
    await expect(pending).resolves.toBeUndefined();
  });

  it('forwards timeoutMs to ys_read_rewrite_field and decodes field metadata', async () => {
    vi.useFakeTimers();
    let mode: 'ok' | 'invalid-id' | 'hang' = 'ok';
    const rewriteAsync = vi.fn((
      window: bigint, text: Buffer, _cap: number, id: Buffer, _idCap: number, info: Buffer,
      includeSelection: number, timeoutMs: number, done: (err: unknown, len: number) => void,
    ) => {
      expect(window).toBe(4242n);
      expect(includeSelection).toBe(1);
      expect(timeoutMs).toBe(900);
      if (mode === 'hang') return;
      text.write('updated', 0, 'utf16le');
      id.writeUInt32LE(0x11223344, 0);
      id.writeUInt32LE(0x55667788, 4);
      info.writeInt32LE(mode === 'invalid-id' ? 0 : 2, 0);
      info.writeInt32LE(3, 4);
      done(null, 7);
    });
    vi.spyOn(koffi, 'load').mockReturnValue(makeFakeLib({
      ys_read_selection: { async: vi.fn() },
      ys_read_rewrite_field: { async: rewriteAsync },
    }) as never);

    const mod = await import('../../electron/nativeSelection');

    await expect(mod.readNativeRewriteField('not-a-hwnd', true, 900)).resolves.toBeUndefined();
    expect(rewriteAsync).not.toHaveBeenCalled();

    await expect(mod.readNativeRewriteField('4242', true, 900)).resolves.toEqual({
      id: '4433221188776655',
      text: 'updated',
      selectionStart: 3,
    });

    mode = 'invalid-id';
    await expect(mod.readNativeRewriteField('4242', true, 900)).resolves.toBeUndefined();

    mode = 'hang';
    const pending = mod.readNativeRewriteField('4242', true, 900);
    vi.advanceTimersByTime(1400);
    await expect(pending).resolves.toBeUndefined();
  });

  it('passes exact UTF-8 byte lengths for rich clipboard writes and forwards shortcut guards', async () => {
    const writeRich = vi.fn(() => 77);
    const restore = vi.fn(() => 1);
    const sendShortcut = vi.fn(() => 1);
    vi.spyOn(koffi, 'load').mockReturnValue(makeFakeLib({
      ys_read_selection: { async: vi.fn() },
      ys_clipboard_write_rich_text: writeRich,
      ys_clipboard_restore: restore,
      ys_send_clipboard_shortcut: sendShortcut,
    }) as never);

    const mod = await import('../../electron/nativeSelection');

    const cfHtml = 'Version:0.9\r\n<!--StartFragment--><b>café</b><!--EndFragment-->';
    expect(mod.nativeWriteClipboardRichText('café', cfHtml, true)).toBe(77);
    expect(writeRich).toHaveBeenCalledTimes(1);
    const [textBuf, textLen, htmlBuf, htmlBytes, exclude] = writeRich.mock.calls[0] as unknown as [Buffer, number, Buffer, number, number];
    expect(textLen).toBe('café'.length);
    expect(textBuf.toString('utf16le', 0, textLen * 2)).toBe('café');
    expect(htmlBytes).toBe(Buffer.byteLength(cfHtml, 'utf8'));
    expect(htmlBuf.toString('utf8', 0, htmlBytes)).toBe(cfHtml);
    expect(exclude).toBe(1);

    expect(mod.nativeRestoreClipboard(0n, 77)).toBe(false);
    expect(restore).not.toHaveBeenCalled();
    expect(mod.nativeRestoreClipboard(99n, 77)).toBe(true);
    expect(restore).toHaveBeenCalledWith(99n, 77);

    expect(mod.sendNativeClipboardShortcut('555', 77, 'ctrl+v', 10n, 20n)).toBe(true);
    expect(sendShortcut).toHaveBeenCalledWith(555n, 77, 0x56, 0, 10n, 20n);
    expect(mod.sendNativeClipboardShortcut('555', 77, 'ctrl+shift+c', 0n, 20n)).toBe(true);
    expect(sendShortcut).toHaveBeenCalledWith(555n, 77, 0x43, 1, 0n, 20n);
    expect(mod.sendNativeClipboardShortcut('bad', 77, 'ctrl+c')).toBe(false);
  });
});

describe.runIf(process.platform === 'win32')('nativeSelection real yapyap-text.dll smoke tests', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('loads the compiled DLL and runs repeated read-only UIA queries on the worker thread', async () => {
    const mod = await import('../../electron/nativeSelection');
    expect(mod.nativeSelectionAvailable()).toBe(true);

    // Multiple sequential and concurrent calls verify UiaWorker handles repeat & queued jobs cleanly.
    for (let i = 0; i < 3; i++) {
      const result = await mod.readNativeSelection(1500, true);
      expect(result).toBeDefined();
      expect(typeof result?.text).toBe('string');
      expect(typeof result?.editable).toBe('boolean');
      expect(typeof result?.password).toBe('boolean');
      expect(typeof result?.process).toBe('string');
    }

    const burst = await Promise.all(
      Array.from({ length: 5 }, () => mod.readNativeSelection(1500, true)),
    );
    for (const item of burst) {
      expect(item).toBeDefined();
      expect(typeof item?.text).toBe('string');
    }

    expect(['selection', 'implicit-line', 'object', 'unknown']).toContain(mod.nativeInspectCopyMetadata());
    expect(mod.nativeFocusedWindow('0')).toBe(0n);
    await expect(mod.readNativeRewriteField('0', false, 500)).resolves.toBeUndefined();
  });
});
