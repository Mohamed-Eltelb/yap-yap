import { describe, expect, it, vi } from 'vitest';
import { plainTextFromClipboardSnapshot, writeLinuxClipboardText } from '../../electron/linuxClipboard';

describe('linuxClipboard', () => {
  it('recognizes plain-text X11 clipboard snapshots including standard X11 atoms', async () => {
    const plain = await plainTextFromClipboardSnapshot([{
      'text/plain': new Blob(['hello café 🦊'], { type: 'text/plain' }),
      'electron application/osclipboard;format="TARGETS"': new Blob(['']),
      'electron application/osclipboard;format="TIMESTAMP"': new Blob(['']),
      'electron application/osclipboard;format="UTF8_STRING"': new Blob(['hello café 🦊']),
      'electron application/osclipboard;format="text/plain;charset=utf-8"': new Blob(['hello café 🦊']),
      'electron application/osclipboard;format="COMPOUND_TEXT"': new Blob(['']),
      'electron application/osclipboard;format="SAVE_TARGETS"': new Blob(['']),
    }]);
    expect(plain).toBe('hello café 🦊');
  });

  it('returns undefined when a snapshot includes rich formats or images', async () => {
    expect(await plainTextFromClipboardSnapshot([{
      'text/plain': new Blob(['hello']),
      'text/html': new Blob(['<b>hello</b>']),
    }])).toBeUndefined();
    expect(await plainTextFromClipboardSnapshot([{
      'text/plain': new Blob(['hello']),
      'image/png': new Blob(['png']),
    }])).toBeUndefined();
    expect(await plainTextFromClipboardSnapshot([])).toBeUndefined();
  });

  it('uses wl-copy on Wayland via stdin and --clear for empty text', async () => {
    const runner = vi.fn().mockResolvedValue(true);
    expect(await writeLinuxClipboardText('--leading-dash', true, runner)).toBe(true);
    expect(runner).toHaveBeenCalledWith('wl-copy', ['--type', 'text/plain;charset=utf-8'], '--leading-dash');

    runner.mockClear();
    expect(await writeLinuxClipboardText('', true, runner)).toBe(true);
    expect(runner).toHaveBeenCalledWith('wl-copy', ['--clear'], undefined);
  });

  it('uses xclip on X11 and falls back to xsel when xclip is unavailable', async () => {
    const xclipOk = vi.fn().mockResolvedValue(true);
    expect(await writeLinuxClipboardText('hello', false, xclipOk)).toBe(true);
    expect(xclipOk).toHaveBeenCalledExactlyOnceWith('xclip', ['-selection', 'clipboard', '-in'], 'hello');

    const xselFallback = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await writeLinuxClipboardText('hello', false, xselFallback)).toBe(true);
    expect(xselFallback).toHaveBeenNthCalledWith(1, 'xclip', ['-selection', 'clipboard', '-in'], 'hello');
    expect(xselFallback).toHaveBeenNthCalledWith(2, 'xsel', ['--clipboard', '--input'], 'hello');

    const neither = vi.fn().mockResolvedValue(false);
    expect(await writeLinuxClipboardText('hello', false, neither)).toBe(false);
  });
});
