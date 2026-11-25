import { UiohookKey, uIOhook } from 'uiohook-napi';
import type { ShortcutPhase } from './hudActions';
import { ShortcutFlow, type AppStatus } from './shortcutFlow';
import { isMenuKey, maskKeys, matchShortcut, needsMenuMask, startsShortcut, swallowedKeys } from './shortcutMatch';
import { KEYS_RESET, setWindowsSwallowedKeys, startWindowsKeyHook, stopWindowsKeyHook } from './windowsKeyHook';

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

// On Linux, uiohook listens through the X server and aborts the whole app when there is
// none, as on a Wayland desktop without Xwayland. Without it, hook-only shortcuts don't work.
export const keyHookAvailable = process.platform !== 'linux' || Boolean(process.env.DISPLAY);

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

type FlowHandlers = { appStatus: () => AppStatus; onPhase: (phase: ShortcutPhase) => void; onStop: () => void; onTogglePause: () => void };
let handlers: FlowHandlers | undefined;
const flow = new ShortcutFlow({
  holdMs: 600,
  pauseHoldMs: 400,
  appStatus: () => handlers?.appStatus() ?? 'idle',
  emit: (out) => {
    if (out.type === 'start') bindings[out.binding]?.trigger();
    else if (out.type === 'stop') handlers?.onStop();
    else if (out.type === 'toggle-pause') handlers?.onTogglePause();
    else handlers?.onPhase(out.type);
  },
});

/** The shortcut editor must see the keys exactly as pressed, and shows nothing for them. */
export function setMenuMasking(enabled: boolean) {
  maskMenus = enabled;
  if (!enabled) flow.reset();
  syncSwallowedKeys();
}

/** The shortcut editor records Right Alt, so nothing is swallowed or masked while it is in use. */
function syncSwallowedKeys() {
  const active = nativeHook && maskMenus;
  const keys = active ? swallowedKeys(bindings) : { leads: [], chords: [] };
  swallowed = keys.leads;
  if (nativeHook) setWindowsSwallowedKeys({ ...keys, masks: active ? maskCodes : [] });
}

/**
 * maskCombos are the shortcuts Windows' own shortcut system handles. Their Alt or Windows
 * key still reaches the focused app, so the native hook masks it.
 */
export function registerModifierShortcuts(
  shortcuts: { combo: string[]; trigger: () => void }[],
  flowHandlers: FlowHandlers,
  maskCombos: string[][] = [],
) {
  handlers = flowHandlers;
  flow.reset();
  bindings = shortcuts.map(({ combo, trigger }) => ({
    keys: combo.map((key) => resolveKey(key)!),
    trigger,
  }));
  maskCodes = process.platform === 'win32'
    ? maskKeys(maskCombos.filter(canHookShortcut).map((combo) => combo.map((key) => resolveKey(key)!)))
    : [];
  if (bindings.length === 0 && maskCodes.length === 0) {
    stopModifierShortcuts();
    return;
  }
  pending = undefined;
  pressed.clear();
  menuHeld = false;
  if (!running) {
    // On Windows Yap Yap's own hook watches keys, so it can swallow Right Alt.
    nativeHook = process.platform === 'win32' && startWindowsKeyHook((down, code, time) => {
      if (code === KEYS_RESET) forgetPressedKeys();
      else if (down) handleKeyDown(code, time);
      else handleKeyUp(code);
    });
    if (!nativeHook) {
      // uiohook cannot mask in time, so it is only worth starting for hook shortcuts.
      if (bindings.length === 0 || !keyHookAvailable) return;
      uIOhook.start();
    }
    running = true;
  }
  syncSwallowedKeys();
}

/** Ctrl+Alt+Del, UAC and the lock screen take the keyboard without sending key-ups. */
function forgetPressedKeys() {
  pressed.clear();
  pending = undefined;
  menuHeld = false;
  flow.reset();
}

let nativeHook = false;
// Keys other apps never see, so they need no menu mask.
let swallowed: number[] = [];
let maskCodes: number[] = [];

let menuHeld = false;

function maskMenu() {
  uIOhook.keyTap(maskKey);
  // A mask sent the instant Alt goes down can be read by the app before the Alt
  // itself, so a second one follows while Alt is still held.
  setTimeout(() => {
    if (menuHeld && maskMenus) {
      uIOhook.keyTap(maskKey);
    }
  }, 15);
}

function unmaskedMenuKeys(): boolean {
  if (swallowed.length === 0) return needsMenuMask(pressed);
  return needsMenuMask(new Map([...pressed].filter(([key]) => !swallowed.includes(key))));
}

function handleKeyDown(keycode: number, time: number) {
  // Holding a key repeats its key-down, and a repeated Alt re-arms the app's menu.
  const repeat = pressed.has(keycode);
  if (keycode === maskKey) return;
  if (!repeat) {
    const windows = process.platform === 'win32';
    pressed.set(keycode, time);
    pending = matchShortcut(bindings, pressed, windows);
    if (maskMenus) flow.keyDown(startsShortcut(bindings, pressed, windows), pending ? bindings.indexOf(pending) : undefined);
  }
  // The hook cannot block keys, so stop the focused app from also acting on the shortcut.
  menuHeld = unmaskedMenuKeys();
  if (pending && maskMenus && process.platform === 'win32' && menuHeld && (!repeat || isMenuKey(keycode))) {
    maskMenu();
  }
}

function handleKeyUp(keycode: number) {
  if (keycode === maskKey || !pressed.delete(keycode)) return;
  menuHeld = unmaskedMenuKeys();
  // Wait until the chord is fully released so held modifiers do not affect auto-paste.
  if (pressed.size > 0) return;
  pending = undefined;
  if (maskMenus) flow.allReleased();
  else flow.reset();
}

uIOhook.on('keydown', ({ keycode, time }) => handleKeyDown(keycode, time));
uIOhook.on('keyup', ({ keycode }) => handleKeyUp(keycode));

/** True while Yap Yap's own Windows hook keeps Right Alt and its chords from other apps. */
export function swallowsKeys(): boolean {
  return running && nativeHook;
}

export function stopModifierShortcuts() {
  if (running && nativeHook) stopWindowsKeyHook();
  else if (running) uIOhook.stop();
  nativeHook = false;
  swallowed = [];
  running = false;
  pending = undefined;
  pressed.clear();
  menuHeld = false;
  flow.reset();
}

export function pasteWithKeyboard(): void {
  uIOhook.keyTap(UiohookKey.V, [UiohookKey.Ctrl]);
}
