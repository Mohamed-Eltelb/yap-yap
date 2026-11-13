import { UiohookKey, uIOhook } from 'uiohook-napi';

const modifierKeys: Record<string, number[]> = {
  'Right Alt': [UiohookKey.AltRight],
  'Left Alt': [UiohookKey.Alt],
  Alt: [UiohookKey.Alt, UiohookKey.AltRight],
  'Right Shift': [UiohookKey.ShiftRight],
  'Left Shift': [UiohookKey.Shift],
  Shift: [UiohookKey.Shift, UiohookKey.ShiftRight],
  'Right Ctrl': [UiohookKey.CtrlRight],
  'Left Ctrl': [UiohookKey.Ctrl],
  Ctrl: [UiohookKey.Ctrl, UiohookKey.CtrlRight],
  Meta: [UiohookKey.Meta, UiohookKey.MetaRight],
};
modifierKeys.Control = modifierKeys.Ctrl;
modifierKeys.Cmd = modifierKeys.Command = modifierKeys.Meta;

type Binding = { keys: number[][]; trigger: () => void };
let bindings: Binding[] = [];
let running = false;
const pressed = new Set<number>();
let pending: Binding | undefined;

export function registerModifierShortcuts(shortcuts: { combo: string[]; trigger: () => void }[]) {
  bindings = shortcuts.map(({ combo, trigger }) => ({
    keys: combo.map((key) => modifierKeys[key.trim()]),
    trigger,
  }));
  if (bindings.length === 0) {
    stopModifierShortcuts();
    return;
  }
  pending = undefined;
  if (!running) {
    uIOhook.start();
    running = true;
  }
}

uIOhook.on('keydown', ({ keycode }) => {
  if (pressed.has(keycode)) return;
  pressed.add(keycode);
  pending = bindings.find(({ keys }) =>
    keys.length === pressed.size && keys.every((options) => options.some((key) => pressed.has(key)))
  );
});

uIOhook.on('keyup', ({ keycode }) => {
  if (!pressed.delete(keycode)) return;
  // Wait for release so a tap of Right Alt can be distinguished from a chord.
  const binding = pending;
  pending = undefined;
  binding?.trigger();
});

export function stopModifierShortcuts() {
  if (running) uIOhook.stop();
  running = false;
  pending = undefined;
  pressed.clear();
}
