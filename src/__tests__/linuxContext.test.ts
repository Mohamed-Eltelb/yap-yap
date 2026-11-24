import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(),
  execFile,
}));

describe.runIf(process.platform === 'linux')('Wayland context', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland');
    vi.stubEnv('DISPLAY', ':0'); // Xwayland can coexist with the native editor.
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    execFile.mockReset();
  });

  it('keeps an empty AT-SPI selection empty after a clipboard write', async () => {
    execFile.mockImplementation((_file, _args, _options, done) => {
      done(null, '{}');
      return {};
    });
    const { captureSelection } = await import('../../electron/dictationContext');
    const clipboard = vi.fn().mockResolvedValue('last dictation');
    expect(await captureSelection(clipboard)).toBeUndefined();
    expect(clipboard).not.toHaveBeenCalled();
  });

  it('reads the focused field from the process with the active accessible window', async () => {
    execFile.mockImplementation((file, args, _options, done) => {
      if (file === 'ps') done(null, 'chromium');
      else if (file === '/usr/bin/python3' && args[3] === 'pid') done(null, '{"pid":4321}');
      else if (file === '/usr/bin/python3' && args.slice(2).join(' ') === '4321 field browser') {
        done(null, '{"field":"4321:/editor","text":"meadow"}');
      } else throw new Error('Unexpected foreground lookup');
      return {};
    });
    const { readFocusedField } = await import('../../electron/dictationContext');
    expect(await readFocusedField()).toEqual({ field: '4321:/editor', text: 'meadow' });
  });

  it('declines an overlapping paste and releases the editor after a failed delivery', async () => {
    let finishInsert: (error: Error | null, output: string) => void;
    execFile.mockImplementation((_file, args, _options, done) => {
      if (args[3] === 'pid') done(null, '{"pid":4321}');
      else if (args[3] === 'insert') finishInsert = done;
      else throw new Error('Unexpected probe');
      return {};
    });
    const { insertWaylandText } = await import('../../electron/dictationContext');
    const first = insertWaylandText('first');
    expect(await insertWaylandText('second')).toBe(false);
    await vi.waitFor(() => expect(finishInsert).toBeTypeOf('function'));
    finishInsert!(new Error('Editor closed'), '');
    expect(await first).toBe(false);
    execFile.mockClear();
    const next = insertWaylandText('next');
    await vi.waitFor(() => expect(execFile).toHaveBeenCalledTimes(2));
    finishInsert!(null, '{"inserted":true}');
    expect(await next).toBe(true);
  });
});
