import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(),
  execFile,
}));

describe.runIf(process.platform === 'linux')('Linux selection and context', () => {
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
      if (args[3] === 'insert') finishInsert = done;
      else throw new Error('Unexpected probe');
      return {};
    });
    const { captureSelection, insertWaylandText } = await import('../../electron/dictationContext');
    const first = insertWaylandText('first');
    expect(await insertWaylandText('second')).toBe(false);
    expect(await captureSelection()).toBeUndefined();
    await vi.waitFor(() => expect(finishInsert).toBeTypeOf('function'));
    finishInsert!(new Error('Editor closed'), '');
    expect(await first).toBe(false);
    execFile.mockClear();
    const next = insertWaylandText('next');
    await vi.waitFor(() => expect(execFile).toHaveBeenCalledTimes(1));
    finishInsert!(null, '{"inserted":true}');
    expect(await next).toBe(true);
  });

  it('passes its own process id to skip Yap Yap windows when scanning with pid 0', async () => {
    execFile.mockImplementation((_file, args, _options, done) => {
      if (args[3] === 'selection') {
        expect(args.slice(2)).toEqual(['0', 'selection', 'app', String(process.pid), 'wayland']);
        done(null, '{"text":"chosen","editable":true,"linuxTarget":[":1.23","/field",0,6]}');
      } else {
        throw new Error(`Unexpected probe: ${args.slice(2).join(' ')}`);
      }
      return {};
    });
    const { captureSelection } = await import('../../electron/dictationContext');
    expect(await captureSelection()).toEqual({ text: 'chosen', truncated: false, editable: true, linuxTarget: [':1.23', '/field', 0, 6] });
  });

  it('allows reading a selection when the probe cannot identify the editable field', async () => {
    execFile.mockImplementation((_file, _args, _options, done) => {
      done(null, '{"text":"chosen","editable":true}');
      return {};
    });
    const { captureSelection } = await import('../../electron/dictationContext');
    expect(await captureSelection()).toEqual({ text: 'chosen', truncated: false, editable: false });
  });

  it('sends the captured field and range in the same probe that performs the rewrite', async () => {
    const end = vi.fn();
    execFile.mockImplementation((_file, args, _options, done) => {
      expect(args.slice(2)).toEqual(['0', 'replace', 'app', String(process.pid), 'wayland']);
      done(null, '{"inserted":true}');
      return { stdin: { on: vi.fn(), end } };
    });
    const { insertWaylandText } = await import('../../electron/dictationContext');
    const target: [string, string, number, number] = [':1.23', '/field', 2, 8];
    expect(await insertWaylandText('updated', {
      text: 'chosen', truncated: false, editable: true, linuxTarget: target,
    })).toBe(true);
    expect(JSON.parse(end.mock.calls[0][0])).toEqual({ text: 'updated', selectedText: 'chosen', target });
  });

  it('retains the X11 rewrite target from the foreground editor', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'x11');
    vi.stubEnv('WAYLAND_DISPLAY', '');
    const linuxTarget = [':1.23', '/field', 2, 8];
    execFile.mockImplementation((file, args, _options, done) => {
      if (file === 'xdotool') {
        expect(args).toEqual(['getactivewindow', 'getwindowpid']);
        done(null, '4321');
      } else {
        expect(args.slice(2)).toEqual(['4321', 'selection', 'app']);
        done(null, JSON.stringify({ text: 'chosen', editable: true, linuxTarget }));
      }
      return {};
    });
    const { captureSelection } = await import('../../electron/dictationContext');
    expect(await captureSelection()).toEqual({ text: 'chosen', truncated: false, editable: true, linuxTarget });
  });

});
