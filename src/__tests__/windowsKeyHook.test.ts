import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => 'Z:/missing' } }));

describe('Windows key hook loader', () => {
  it('falls back when the hook cannot load', async () => {
    const { startWindowsKeyHook } = await import('../../electron/windowsKeyHook');
    expect(startWindowsKeyHook(() => undefined)).toBe(false);
  });
});
