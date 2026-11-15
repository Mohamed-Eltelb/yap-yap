import { appendFile } from 'node:fs';
import { UiohookKey, uIOhook } from 'uiohook-napi';
import type { ShortcutPhase } from './hudActions';
import { ShortcutFlow, type AppStatus } from './shortcutFlow';
import { isMenuKey, matchShortcut, needsMenuMask, startsShortcut } from './shortcutMatch';

export type { ShortcutPhase };

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

type FlowHandlers = { appStatus: () => AppStatus; onPhase: (phase: ShortcutPhase) => void; onStop: () => void };
let handlers: FlowHandlers | undefined;
const flow = new ShortcutFlow({
  holdMs: 1000,
  appStatus: () => handlers?.appStatus() ?? 'idle',
  emit: (out) => {
    if (out.type === 'start') bindings[out.binding]?.trigger();
    else if (out.type === 'stop') handlers?.onStop();
    else handlers?.onPhase(out.type);
  },
});

/** The shortcut editor must see the keys exactly as pressed, and shows nothing for them. */
export function setMenuMasking(enabled: boolean) {
  maskMenus = enabled;
  if (!enabled) flow.reset();
}

export function registerModifierShortcuts(
  shortcuts: { combo: string[]; trigger: () => void }[],
  flowHandlers: FlowHandlers,
) {
  handlers = flowHandlers;
  flow.reset();
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
    const windows = process.platform === 'win32';
    pressed.set(keycode, time);
    pending = matchShortcut(bindings, pressed, windows);
    if (maskMenus) flow.keyDown(startsShortcut(bindings, pressed, windows), pending ? bindings.indexOf(pending) : undefined);
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
  pending = undefined;
  if (maskMenus) flow.allReleased();
  else flow.reset();
});

export function stopModifierShortcuts() {
  if (running) uIOhook.stop();
  running = false;
  pending = undefined;
  pressed.clear();
  menuHeld = false;
  flow.reset();
}

export function pasteWithKeyboard(): void {
  uIOhook.keyTap(UiohookKey.V, [UiohookKey.Ctrl]);
}
