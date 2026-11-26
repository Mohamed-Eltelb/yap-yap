import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeSelection } from '../../electron/nativeSelection';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
  readNativeSelection: vi.fn<(...args: [number?, boolean?]) => Promise<NativeSelection | undefined>>(),
}));

vi.mock('node:child_process', () => ({
  spawn: mocks.spawn,
  execFile: mocks.execFile,
}));

vi.mock('../../electron/nativeSelection', () => ({
  readNativeSelection: mocks.readNativeSelection,
}));

class FakeStream extends EventEmitter {
  setEncoding = vi.fn();
  resume = vi.fn();
}

class FakeChild extends EventEmitter {
  stdout = new FakeStream();
  stderr = new FakeStream();
  written: string[] = [];
  stdin = {
    write: vi.fn((chunk: string) => {
      this.written.push(chunk);
      return true;
    }),
  };
  kill = vi.fn(() => {
    this.emit('exit', 1);
    return true;
  });

  reply(id: number, json: unknown): void {
    this.stdout.emit('data', `${id} ${JSON.stringify(json)}\n`);
  }
}

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

describe('dictationContext Windows helper recovery and selection routing', () => {
  let children: FakeChild[];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setPlatform('win32');
    children = [];
    mocks.spawn.mockImplementation(() => {
      const child = new FakeChild();
      children.push(child);
      return child;
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', originalPlatform);
  });

  it('reuses a warm PowerShell helper across context and field calls', async () => {
    const mod = await import('../../electron/dictationContext');

    const ctxPromise = mod.captureDictationContext();
    expect(children).toHaveLength(1);
    expect(children[0].written[0]).toBe('1 \n');
    children[0].reply(1, { application: 'Google Chrome', address: 'https://github.com/org/repo', textBefore: 'hello ' });
    await expect(ctxPromise).resolves.toEqual({
      application: 'Google Chrome',
      domain: 'github.com',
      textBefore: 'hello ',
      textAfter: undefined,
    });

    const fieldPromise = mod.readFocusedField();
    expect(children).toHaveLength(1);
    expect(children[0].written[1]).toBe('2 field\n');
    children[0].reply(2, { field: '42.7', text: 'draft message' });
    await expect(fieldPromise).resolves.toEqual({ field: '42.7', text: 'draft message' });

    mod.stopDictationContext();
    expect(children[0].kill).toHaveBeenCalledTimes(1);
  });

  it('recycles a cold-start PowerShell helper after two consecutive timeouts and recovers on the next call', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const mod = await import('../../electron/dictationContext');

    // First timeout within 4s of launch: allowed so cold-start PowerShell can finish loading.
    const first = mod.captureDictationContext();
    expect(children).toHaveLength(1);
    vi.advanceTimersByTime(1500);
    await expect(first).resolves.toBeUndefined();
    expect(children[0].kill).not.toHaveBeenCalled();

    // Second consecutive timeout: recycle the wedged helper.
    const second = mod.captureDictationContext();
    vi.advanceTimersByTime(1500);
    await expect(second).resolves.toBeUndefined();
    expect(children[0].kill).toHaveBeenCalledTimes(1);

    // Subsequent call spawns a fresh PowerShell helper and succeeds.
    const third = mod.captureDictationContext();
    expect(children).toHaveLength(2);
    const id = Number(children[1].written[0].split(' ')[0]);
    children[1].reply(id, { application: 'Notepad' });
    await expect(third).resolves.toEqual({
      application: 'Notepad',
      domain: undefined,
      textBefore: undefined,
      textAfter: undefined,
    });
  });

  it('recycles a warm PowerShell helper on the first timeout after it has been alive over 4 seconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const mod = await import('../../electron/dictationContext');

    const warmup = mod.captureDictationContext();
    children[0].reply(1, { application: 'Code' });
    await expect(warmup).resolves.toMatchObject({ application: 'Code' });

    vi.advanceTimersByTime(4500);

    const hung = mod.readFocusedField();
    vi.advanceTimersByTime(1500);
    await expect(hung).resolves.toBeUndefined();
    expect(children[0].kill).toHaveBeenCalledTimes(1);

    const recovered = mod.readFocusedField();
    expect(children).toHaveLength(2);
    const id = Number(children[1].written[0].split(' ')[0]);
    children[1].reply(id, { field: '1.2', text: 'ok' });
    await expect(recovered).resolves.toEqual({ field: '1.2', text: 'ok' });
  });

  it('recycles the PowerShell helper immediately if stdin.write throws', async () => {
    const mod = await import('../../electron/dictationContext');

    const warmup = mod.captureDictationContext();
    children[0].reply(1, { application: 'Code' });
    await warmup;

    children[0].stdin.write.mockImplementationOnce(() => {
      throw new Error('EPIPE');
    });
    await expect(mod.captureDictationContext()).resolves.toBeUndefined();
    expect(children[0].kill).toHaveBeenCalledTimes(1);

    const next = mod.captureDictationContext();
    expect(children).toHaveLength(2);
    const id = Number(children[1].written[0].split(' ')[0]);
    children[1].reply(id, { application: 'Slack' });
    await expect(next).resolves.toMatchObject({ application: 'Slack' });
  });

  it('returns native Windows selection directly without calling Copy', async () => {
    const mod = await import('../../electron/dictationContext');
    const copy = vi.fn();

    mocks.readNativeSelection.mockResolvedValueOnce({
      text: 'selected text',
      editable: true,
      password: false,
      process: 'chrome',
    });
    await expect(mod.captureSelection(copy, false)).resolves.toEqual({
      text: 'selected text',
      truncated: false,
      editable: true,
      process: 'chrome',
    });
    expect(mocks.readNativeSelection).toHaveBeenLastCalledWith(4000, false);
    expect(copy).not.toHaveBeenCalled();
  });

  it('never falls back to Copy when the native selection reports a password field', async () => {
    const mod = await import('../../electron/dictationContext');
    const copy = vi.fn();

    mocks.readNativeSelection.mockResolvedValueOnce({
      text: '',
      editable: false,
      password: true,
      process: 'chrome',
    });
    await expect(mod.captureSelection(copy, false)).resolves.toBeUndefined();
    expect(copy).not.toHaveBeenCalled();
  });

  it('allows Ctrl+C fallback and editable rewrite when native UIA finds an empty writable field', async () => {
    const mod = await import('../../electron/dictationContext');
    const copy = vi.fn().mockResolvedValueOnce({ text: 'copied snippet' });

    mocks.readNativeSelection.mockResolvedValueOnce({
      text: '',
      editable: false,
      password: false,
      writableField: true,
      inTerminal: false,
      uiaOpaque: false,
      process: 'Code',
    });
    await expect(mod.captureSelection(copy, true)).resolves.toEqual({
      text: 'copied snippet',
      truncated: false,
      editable: true,
      viaCopy: true,
      process: 'Code',
    });
    expect(mocks.readNativeSelection).toHaveBeenLastCalledWith(1200, true);
    expect(copy).toHaveBeenLastCalledWith('Code', { allowCtrlCFallback: true, inTerminal: false });
  });

  it('disables Ctrl+C fallback and forces read-only when UIA reports a terminal', async () => {
    const mod = await import('../../electron/dictationContext');
    const copy = vi.fn().mockResolvedValueOnce({ text: 'ls -la' });

    mocks.readNativeSelection.mockResolvedValueOnce({
      text: '',
      editable: false,
      password: false,
      writableField: true,
      inTerminal: true,
      uiaOpaque: false,
      process: 'Code',
    });
    await expect(mod.captureSelection(copy, false)).resolves.toEqual({
      text: 'ls -la',
      truncated: false,
      editable: false,
      viaCopy: true,
      process: 'Code',
    });
    expect(copy).toHaveBeenLastCalledWith('Code', { allowCtrlCFallback: false, inTerminal: true });

    copy.mockClear();
    mocks.readNativeSelection.mockResolvedValueOnce({
      text: '',
      editable: false,
      password: false,
      writableField: true,
      inTerminal: true,
      uiaOpaque: false,
      process: 'Code',
    });
    await expect(mod.captureSelection(copy, true)).resolves.toBeUndefined();
    expect(copy).not.toHaveBeenCalled();
  });

  it('disables Ctrl+C fallback for opaque UIA apps and respects readOnly from Copy', async () => {
    const mod = await import('../../electron/dictationContext');
    const copy = vi.fn().mockResolvedValueOnce({ text: 'cell text', readOnly: true });

    mocks.readNativeSelection.mockResolvedValueOnce({
      text: '',
      editable: false,
      password: false,
      writableField: true,
      inTerminal: false,
      uiaOpaque: true,
      process: 'custom-app',
    });
    await expect(mod.captureSelection(copy, false)).resolves.toEqual({
      text: 'cell text',
      truncated: false,
      editable: false,
      viaCopy: true,
      process: 'custom-app',
    });
    expect(copy).toHaveBeenLastCalledWith('custom-app', { allowCtrlCFallback: false, inTerminal: false });
  });

  it('falls back to PowerShell for Ask Anything when the DLL is unavailable, but skips rewrite', async () => {
    const mod = await import('../../electron/dictationContext');
    const copy = vi.fn();

    // Rewrite refuses to proceed without the native DLL.
    mocks.readNativeSelection.mockResolvedValueOnce(undefined);
    await expect(mod.captureSelection(copy, true)).resolves.toBeUndefined();
    expect(children).toHaveLength(0);
    expect(copy).not.toHaveBeenCalled();

    // Ask Anything falls back to PowerShell helper.
    mocks.readNativeSelection.mockResolvedValueOnce(undefined);
    const pending = mod.captureSelection(copy, false);
    // Allow readNativeSelection microtask to settle so askWindowsHelper spawns the child.
    await Promise.resolve();
    expect(children).toHaveLength(1);
    expect(children[0].written[0]).toBe('1 selection\n');
    children[0].reply(1, { text: 'from powershell', editable: false });
    await expect(pending).resolves.toEqual({
      text: 'from powershell',
      truncated: false,
      editable: false,
    });
  });
});
