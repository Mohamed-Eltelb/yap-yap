import { appendFile } from 'node:fs';
import { UiohookKey, uIOhook } from 'uiohook-napi';
import { isMenuKey, matchShortcut, needsMenuMask } from './shortcutMatch';

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
const keyCodes: Record<string, number> = UiohookKey;
const punctuation: Record<string, string> = {
  ';': 'Semicolon', '=': 'Equal', ',': 'Comma', '-': 'Minus', '.': 'Period',
  '/': 'Slash', '`': 'Backquote', '[': 'BracketLeft', ']': 'BracketRight',
  '\\': 'Backslash', "'": 'Quote',
};

export function canHookShortcut(combo: string[]): boolean {
  return combo.length > 0 && combo.every((key) => resolveKey(key) !== undefined);
}

function resolveKey(key: string): number[] | undefined {
  const name = key === ' ' ? 'Space' : key.trim();
  if (Object.hasOwn(modifierKeys, name)) return modifierKeys[name];
  const code = keyCodes[punctuation[name] ?? name];
  return typeof code === 'number' ? [code] : undefined;
}

let bindings: Binding[] = [];
let running = false;
const pressed = new Map<number, number>();
let pending: Binding | undefined;
let maskMenus = true;
// Never bound by apps, so tapping it has no effect of its own.
const maskKey = UiohookKey.F24;

/** The shortcut editor must see the keys exactly as pressed. */
export function setMenuMasking(enabled: boolean) {
  maskMenus = enabled;
}

export function registerModifierShortcuts(shortcuts: { combo: string[]; trigger: () => void }[]) {
  bindings = shortcuts.map(({ combo, trigger }) => ({
    keys: combo.map((key) => resolveKey(key)!),
    trigger,
  }));
  if (bindings.length === 0) {
    stopModifierShortcuts();
    return;
  }
  pending = undefined;
  pressed.clear();
  menuHeld = false;
  if (!running) {
    uIOhook.start();
    running = true;
  }
}

let menuHeld = false;

// The last key events, kept in memory so a menu that opened can be traced back
// to the keys around it without writing anything while keys are pressed.
const history: string[] = [];
function remember(line: string) {
  history.push(`${Date.now()} ${line}`);
  if (history.length > 200) history.shift();
}

export function saveKeyHistory(file: string, reason: string) {
  const text = `--- ${new Date().toISOString()} ${reason}\n${history.join('\n')}\n`;
  appendFile(file, text, () => undefined);
}

function maskMenu() {
  uIOhook.keyTap(maskKey);
  remember('mask');
  // A mask sent the instant Alt goes down can be read by the app before the Alt
  // itself, so a second one follows while Alt is still held.
  setTimeout(() => {
    if (menuHeld && maskMenus) {
      uIOhook.keyTap(maskKey);
      remember('mask again');
    }
  }, 15);
}

uIOhook.on('keydown', ({ keycode, time }) => {
  // Holding a key repeats its key-down, and a repeated Alt re-arms the app's menu.
  const repeat = pressed.has(keycode);
  remember(`down ${keycode} t=${time}${repeat ? ' repeat' : ''} masking=${maskMenus}`);
  if (keycode === maskKey) return;
  if (!repeat) {
    pressed.set(keycode, time);
    pending = matchShortcut(bindings, pressed, process.platform === 'win32');
  }
  // The hook cannot block keys, so stop the focused app from also acting on the shortcut.
  menuHeld = needsMenuMask(pressed);
  if (pending && maskMenus && process.platform === 'win32' && menuHeld && (!repeat || isMenuKey(keycode))) {
    maskMenu();
  }
});

uIOhook.on('keyup', ({ keycode, time }) => {
  remember(`up ${keycode} t=${time}`);
  if (keycode === maskKey || !pressed.delete(keycode)) return;
  menuHeld = needsMenuMask(pressed);
  // Wait until the chord is fully released so held modifiers do not affect auto-paste.
  if (pressed.size > 0) return;
  const binding = pending;
  pending = undefined;
  binding?.trigger();
});

export function stopModifierShortcuts() {
  if (running) uIOhook.stop();
  running = false;
  pending = undefined;
  pressed.clear();
  menuHeld = false;
}

export function pasteWithKeyboard(): void {
  uIOhook.keyTap(UiohookKey.V, [UiohookKey.Ctrl]);
}
