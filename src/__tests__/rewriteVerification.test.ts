import { describe, expect, it, vi } from 'vitest';
import { confirmRewrite, expectedRewrite, type RewriteField } from '../../electron/rewriteVerification';

describe('Windows rewrite verification', () => {
  const original: RewriteField = { id: 'field', text: 'One then One', selectionStart: 9 };
  const after = { ...original, text: 'One then Two', selectionStart: -1 };

  it('uses the selection offset when the same words occur twice', () => {
    expect(expectedRewrite(original, 'One', 'Two')).toBe(after.text);
    expect(expectedRewrite({ ...original, selectionStart: -1 }, 'One', 'Two')).toBeUndefined();
    expect(expectedRewrite({ ...original, selectionStart: 1 }, 'One', 'Two')).toBeUndefined();
  });

  it('maps Windows line breaks and the UTF-16 selection offset', () => {
    const field = { id: 'field', text: '\u{1F642}\r\nOriginal\r\nend', selectionStart: 4 };
    expect(expectedRewrite(field, 'Original', 'Line 1\r\nLine 2')).toBe('\u{1F642}\nLine 1\nLine 2\nend');
    expect(expectedRewrite({ ...field, selectionStart: -1 }, 'Original', 'New')).toBe('\u{1F642}\nNew\nend');
    expect(expectedRewrite(field, 'Original', 'Original')).toBeUndefined();
  });

  it('waits for a delayed edit and checks the expected change in the same field', async () => {
    const read = vi.fn<() => Promise<RewriteField | undefined>>()
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce({ ...after, text: 'One then ' })
      .mockResolvedValueOnce(after);
    await expect(confirmRewrite(original, after.text, read)).resolves.toBe(true);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('does not confirm a replacement at the wrong occurrence', async () => {
    const read = vi.fn(async () => ({ ...after, text: 'Two then One' }));
    await expect(confirmRewrite(original, after.text, read)).resolves.toBe(false);
  });

  it.each([
    { ...after, id: 'different field' },
    undefined,
  ])('leaves a different or unreadable field unverified', async (field) => {
    const read = vi.fn(async () => field);
    await expect(confirmRewrite(original, after.text, read)).resolves.toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
