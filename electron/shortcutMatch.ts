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

  // Windows sends a synthetic left Ctrl just before right Alt on AltGr layouts.
  const alt = pressed.get(UiohookKey.AltRight);
  const ctrl = pressed.get(UiohookKey.Ctrl);
  if (alt === undefined || ctrl === undefined || alt < ctrl || alt - ctrl > 15) return;
  return bindings.find(({ keys }) => matches(keys, pressed.size - 1, UiohookKey.Ctrl));
}
