import { UiohookKey } from 'uiohook-napi';

const menuKeys: number[] = [UiohookKey.Alt, UiohookKey.AltRight, UiohookKey.Meta, UiohookKey.MetaRight];

/**
 * Releasing Alt or the Windows key on its own opens the focused app's menu or
 * the Start menu. Tapping an unused key while they are held prevents that.
 */
export function needsMenuMask(pressed: ReadonlyMap<number, number>): boolean {
  return menuKeys.some((key) => pressed.has(key));
}

export function isMenuKey(keycode: number): boolean {
  return menuKeys.includes(keycode);
}

/** Windows sends a synthetic left Ctrl just before right Alt on AltGr layouts. */
function isAltGrCtrl(pressed: ReadonlyMap<number, number>, windows: boolean): boolean {
  const alt = pressed.get(UiohookKey.AltRight);
  const ctrl = pressed.get(UiohookKey.Ctrl);
  return windows && alt !== undefined && ctrl !== undefined && alt >= ctrl && alt - ctrl <= 15;
}

/**
 * True when the keys may still become a shortcut: its first key is down and every
 * pressed key belongs to it. Space or Shift alone must not count for Right Alt+Space.
 */
export function startsShortcut<T extends { keys: number[][] }>(
  bindings: T[],
  pressed: ReadonlyMap<number, number>,
  windows: boolean,
): boolean {
  const ignore = isAltGrCtrl(pressed, windows) ? UiohookKey.Ctrl : undefined;
  const keys = [...pressed.keys()].filter((key) => key !== ignore);
  return keys.length > 0 && bindings.some((binding) =>
    binding.keys[0]?.some((key) => pressed.has(key)) &&
    keys.every((key) => binding.keys.some((options) => options.includes(key))));
}

export function matchShortcut<T extends { keys: number[][] }>(
  bindings: T[],
  pressed: ReadonlyMap<number, number>,
  windows: boolean,
): T | undefined {
  const matches = (keys: number[][], size: number, ignore?: number) =>
    keys.length === size &&
    keys.every((options) => options.some((key) => key !== ignore && pressed.has(key)));
  const exact = bindings.find(({ keys }) => matches(keys, pressed.size));
  if (exact || !windows) return exact;

  if (!isAltGrCtrl(pressed, windows)) return;
  return bindings.find(({ keys }) => matches(keys, pressed.size - 1, UiohookKey.Ctrl));
}
