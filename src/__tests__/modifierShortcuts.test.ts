import { afterEach, describe, expect, it, vi } from 'vitest';

const hook = vi.hoisted(() => ({
  setKeys: vi.fn(),
  onEvent: undefined as ((down: boolean, code: number, time: number) => void) | undefined,
  KEYS_RESET: -1,
}));
vi.mock('uiohook-napi', async (importActual) => {
  const actual = await importActual<typeof import('uiohook-napi')>();
  return { ...actual, uIOhook: { on: vi.fn(), start: vi.fn(), stop: vi.fn(), keyTap: vi.fn() } };
});
vi.mock('../../electron/windowsKeyHook', () => ({
  KEYS_RESET: hook.KEYS_RESET,
  startWindowsKeyHook: (cb: (down: boolean, code: number, time: number) => void) => {
    hook.onEvent = cb;
    return true;
  },
  stopWindowsKeyHook: vi.fn(),
  setWindowsSwallowedKeys: hook.setKeys,
}));

describe.runIf(process.platform === 'win32')('Modifier shortcuts on Windows', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lets the shortcut editor see Right Alt, then swallows it again', async () => {
    const { registerModifierShortcuts, setMenuMasking, stopModifierShortcuts, swallowsKeys } = await import('../../electron/modifierShortcuts');
    registerModifierShortcuts([{ combo: ['Right Alt'], trigger: vi.fn() }], { appStatus: () => 'idle', onPhase: vi.fn(), onStop: vi.fn(), onTogglePause: vi.fn() });
    expect(hook.setKeys).toHaveBeenLastCalledWith({ leads: [3640], chords: [], masks: [] });
    // Right Alt chords no longer need a global shortcut to keep them from apps.
    expect(swallowsKeys()).toBe(true);
    setMenuMasking(false);
    expect(hook.setKeys).toHaveBeenLastCalledWith({ leads: [], chords: [], masks: [] });
    setMenuMasking(true);
    expect(hook.setKeys).toHaveBeenLastCalledWith({ leads: [3640], chords: [], masks: [] });
    stopModifierShortcuts();
    expect(swallowsKeys()).toBe(false);
  });

  it('sends mask keys, and none while the editor is focused', async () => {
    const { registerModifierShortcuts, setMenuMasking, stopModifierShortcuts } = await import('../../electron/modifierShortcuts');
    registerModifierShortcuts([], { appStatus: () => 'idle', onPhase: vi.fn(), onStop: vi.fn(), onTogglePause: vi.fn() }, [['Left Alt', '/']]);
    expect(hook.setKeys).toHaveBeenLastCalledWith({ leads: [], chords: [], masks: [53] });
    setMenuMasking(false);
    expect(hook.setKeys).toHaveBeenLastCalledWith({ leads: [], chords: [], masks: [] });
    setMenuMasking(true);
    stopModifierShortcuts();
  });

  it('starts the hook for mask keys alone', async () => {
    const { registerModifierShortcuts, stopModifierShortcuts, swallowsKeys } = await import('../../electron/modifierShortcuts');
    registerModifierShortcuts([], { appStatus: () => 'idle', onPhase: vi.fn(), onStop: vi.fn(), onTogglePause: vi.fn() }, [['Left Alt', '/']]);
    expect(swallowsKeys()).toBe(true);
    stopModifierShortcuts();
    registerModifierShortcuts([], { appStatus: () => 'idle', onPhase: vi.fn(), onStop: vi.fn(), onTogglePause: vi.fn() }, [['Left Ctrl', 'K']]);
    expect(swallowsKeys()).toBe(false);
  });

  it('clears stuck keys and armed flow on resetModifierShortcuts (sleep/unlock)', async () => {
    const { registerModifierShortcuts, resetModifierShortcuts, stopModifierShortcuts } = await import('../../electron/modifierShortcuts');
    const trigger = vi.fn();
    const onPhase = vi.fn();
    registerModifierShortcuts([{ combo: ['Right Alt'], trigger }], {
      appStatus: () => 'idle',
      onPhase,
      onStop: vi.fn(),
      onTogglePause: vi.fn(),
    });

    // Right Alt goes down before lock/sleep and its key-up is dropped.
    hook.onEvent!(true, 3640, 100);
    expect(onPhase).toHaveBeenLastCalledWith('armed');

    resetModifierShortcuts();
    expect(onPhase).toHaveBeenLastCalledWith('closed');

    // A stray key-up after reset must not trigger the shortcut.
    hook.onEvent!(false, 3640, 200);
    expect(trigger).not.toHaveBeenCalled();

    // A fresh tap afterwards works normally.
    hook.onEvent!(true, 3640, 300);
    hook.onEvent!(false, 3640, 350);
    expect(trigger).toHaveBeenCalledTimes(1);

    stopModifierShortcuts();
  });

  it('cancels recording hold timers on resetModifierShortcuts and KEYS_RESET', async () => {
    vi.useFakeTimers();
    const { registerModifierShortcuts, resetModifierShortcuts, stopModifierShortcuts } = await import('../../electron/modifierShortcuts');
    const onStop = vi.fn();
    const onTogglePause = vi.fn();
    registerModifierShortcuts([{ combo: ['Right Alt'], trigger: vi.fn() }], {
      appStatus: () => 'recording',
      onPhase: vi.fn(),
      onStop,
      onTogglePause,
    });

    hook.onEvent!(true, 3640, 100);
    resetModifierShortcuts();
    vi.advanceTimersByTime(600);
    hook.onEvent!(false, 3640, 700);
    expect(onTogglePause).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();

    // Same recovery when the native hook itself emits KEYS_RESET.
    hook.onEvent!(true, 3640, 800);
    hook.onEvent!(false, hook.KEYS_RESET, 850);
    vi.advanceTimersByTime(600);
    hook.onEvent!(false, 3640, 1500);
    expect(onTogglePause).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();

    stopModifierShortcuts();
  });
});
