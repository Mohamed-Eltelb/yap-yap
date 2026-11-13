import { describe, expect, it, vi } from 'vitest';
import { deliverDictationResult } from '../utils/dictationResult';

describe('dictation result delivery', () => {
  it.each(['dictate', 'translate'] as const)('dismisses the %s result after a confirmed paste', async (mode) => {
    const paste = vi.fn().mockResolvedValue(true);
    const copy = vi.fn();
    expect(await deliverDictationResult(mode, 'Result', paste, copy)).toBe(true);
    expect(paste).toHaveBeenCalledWith('Result');
    expect(copy).not.toHaveBeenCalled();
  });

  it('keeps an Ask answer available without pasting it', async () => {
    const paste = vi.fn().mockResolvedValue(true);
    const copy = vi.fn().mockResolvedValue(undefined);
    expect(await deliverDictationResult('ask', 'Answer', paste, copy)).toBe(false);
    expect(paste).not.toHaveBeenCalled();
    expect(copy).toHaveBeenCalledWith('Answer');
  });

  it('keeps the result available if paste and clipboard access fail', async () => {
    const paste = vi.fn().mockRejectedValue(new Error('Paste failed'));
    const copy = vi.fn().mockRejectedValue(new Error('Clipboard unavailable'));
    expect(await deliverDictationResult('dictate', 'Result', paste, copy)).toBe(false);
    expect(copy).toHaveBeenCalledWith('Result');
  });

  it('keeps an unconfirmed translation available to copy', async () => {
    const paste = vi.fn().mockResolvedValue(false);
    expect(await deliverDictationResult('translate', 'Result', paste, vi.fn())).toBe(false);
  });

  it('keeps the result available when auto-paste is disabled', async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    expect(await deliverDictationResult('translate', 'Result', undefined, copy)).toBe(false);
    expect(copy).toHaveBeenCalledWith('Result');
  });
});
