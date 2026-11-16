import { describe, expect, it, vi } from 'vitest';

const hook = vi.hoisted(() => ({ setKeys: vi.fn() }));
vi.mock('uiohook-napi', async (importActual) => {
  const actual = await importActual<typeof import('uiohook-napi')>();
  return { ...actual, uIOhook: { on: vi.fn(), start: vi.fn(), stop: vi.fn(), keyTap: vi.fn() } };
});
vi.mock('../../electron/windowsKeyHook', () => ({
  startWindowsKeyHook: () => true,
  stopWindowsKeyHook: vi.fn(),
  setWindowsSwallowedKeys: hook.setKeys,
}));

describe.runIf(process.platform === 'win32')('Modifier shortcuts on Windows', () => {
  it('lets the shortcut editor see Right Alt, then swallows it again', async () => {
    const { registerModifierShortcuts, setMenuMasking, stopModifierShortcuts, swallowsKeys } = await import('../../electron/modifierShortcuts');
    registerModifierShortcuts([{ combo: ['Right Alt'], trigger: vi.fn() }], { appStatus: () => 'idle', onPhase: vi.fn(), onStop: vi.fn() });
    expect(hook.setKeys).toHaveBeenLastCalledWith({ leads: [3640], chords: [] });
    // Right Alt chords no longer need a global shortcut to keep them from apps.
    expect(swallowsKeys()).toBe(true);
    setMenuMasking(false);
    expect(hook.setKeys).toHaveBeenLastCalledWith({ leads: [], chords: [] });
    setMenuMasking(true);
    expect(hook.setKeys).toHaveBeenLastCalledWith({ leads: [3640], chords: [] });
    stopModifierShortcuts();
    expect(swallowsKeys()).toBe(false);
  });
});
