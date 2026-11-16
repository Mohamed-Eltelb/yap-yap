export const shortcutModes = ['dictate', 'translate', 'ask'] as const;
type ShortcutMode = (typeof shortcutModes)[number];
export type ShortcutGroup = Record<ShortcutMode, string[][]>;
export type ShortcutSlot = { mode: ShortcutMode; index: number };

const sidedModifiers = {
  alt: ['left alt', 'right alt'],
  shift: ['left shift', 'right shift'],
  ctrl: ['left ctrl', 'right ctrl'],
  meta: ['left meta', 'right meta'],
};

function electronKeys(combo: string[]): string[] | null {
  const keys = new Set(combo.map((key) => {
    if (key === ' ') return 'space';
    return key.trim().toLowerCase().replace(/^(left|right) (alt|shift|ctrl)$/, '$2');
  }));
  const mapped = [...keys].map((key) => {
    if (key === 'ctrl' || key === 'control') return 'commandorcontrol';
    if (key === 'cmd' || key === 'meta' || key === 'command') return 'super';
    return key;
  });
  const modifiers = ['alt', 'shift', 'commandorcontrol', 'super'];
  return mapped.some((key) => !modifiers.includes(key)) ? [...new Set(mapped)] : null;
}

export function toElectronAccelerator(combo: string[]): string | null {
  return electronKeys(combo)?.join('+') ?? null;
}

function chordSignatures(combo: string[], platform?: string): string[] {
  // The native hook preserves sides for modifier-only and Right Alt chords.
  const accelerator = combo.includes('Right Alt') ? null : electronKeys(combo);
  const keys = accelerator ?? combo;
  const aliases: Record<string, string> = {
    ' ': 'space', control: 'ctrl', return: 'enter', esc: 'escape',
    commandorcontrol: platform === 'darwin' ? 'meta' : 'ctrl',
    cmdorctrl: platform === 'darwin' ? 'meta' : 'ctrl',
    super: 'meta', cmd: 'meta', command: 'meta', option: 'alt',
    up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright',
    plus: '+',
  };
  const normalized = new Set(keys.map((key) => {
    const name = key === ' ' ? key : key.trim().toLowerCase();
    return Object.hasOwn(aliases, name) ? aliases[name] : name;
  }));
  // On Windows Yap Yap's own hook hides Right Alt from Windows' shortcut system, so a
  // Left Alt accelerator never fires for Right Alt and the two can hold different shortcuts.
  const leftAltOnly = platform === 'win32' && accelerator !== null && combo.includes('Left Alt');
  let chords: string[][] = [[]];
  for (const key of normalized) {
    const options = key === 'alt' && leftAltOnly
      ? ['left alt']
      : Object.hasOwn(sidedModifiers, key)
        ? sidedModifiers[key as keyof typeof sidedModifiers]
        : [key];
    chords = chords.flatMap((chord) => options.map((option) => [...chord, option]));
  }
  return chords.map((chord) => JSON.stringify(chord.sort()));
}

export function findShortcutConflict(
  shortcuts: ShortcutGroup,
  target: ShortcutSlot,
  combo: string[],
  platform?: string,
): ShortcutMode | undefined {
  const signatures = new Set(chordSignatures(combo, platform));
  return shortcutModes.find((mode) => shortcuts[mode].some((assigned, index) =>
    (mode !== target.mode || index !== target.index) &&
    chordSignatures(assigned, platform).some((signature) => signatures.has(signature)),
  ));
}

export function removeDuplicateShortcuts(shortcuts: ShortcutGroup, platform?: string): ShortcutGroup {
  const unique: ShortcutGroup = { dictate: [], translate: [], ask: [] };
  const assigned = new Set<string>();
  for (const mode of shortcutModes) {
    const combos = shortcuts[mode];
    if (!Array.isArray(combos)) continue;
    for (const combo of combos) {
      if (!Array.isArray(combo) || combo.length === 0 || combo.some((key) => typeof key !== 'string')) continue;
      const signatures = chordSignatures(combo, platform);
      if (signatures.some((signature) => assigned.has(signature))) continue;
      unique[mode].push(combo);
      for (const signature of signatures) assigned.add(signature);
    }
  }
  return unique;
}

const metaNames = ['meta', 'left meta', 'right meta', 'win', 'super', 'cmd', 'command'];
const leftAltWindowKeys = ['tab', 'f4', 'escape', 'esc', 'space'];
// Keys that type or edit text. Keys like F8, Scroll Lock or Pause stay free to use.
const typingKeys = ['space', 'enter', 'tab', 'backspace', 'delete', 'escape', 'esc', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];

/**
 * Shortcuts Windows or everyday typing already uses: taking them would break copy and
 * paste, typing a key, switching windows or the keyboard language. Names are as the
 * shortcut editor records them ('Left Alt', 'A', 'Space', 'Meta'…).
 */
export function reservedShortcut(combo: string[]): boolean {
  const keys = combo.map((key) => (key === ' ' ? 'space' : key.trim().toLowerCase()));
  const leftAlt = keys.some((key) => key === 'left alt' || key === 'alt');
  const alt = leftAlt || keys.includes('right alt');
  const ctrl = keys.some((key) => /^(left |right )?(ctrl|control)$/.test(key));
  const shift = keys.some((key) => /^(left |right )?shift$/.test(key));
  const meta = keys.some((key) => metaNames.includes(key));
  const others = keys.filter((key) =>
    !/^(left |right )?(alt|ctrl|control|shift)$/.test(key) && !metaNames.includes(key));
  const ordinary = others.filter((key) => key.length === 1 || typingKeys.includes(key));
  const one = others.length === 1;

  // Plain keys with no modifier would fire during normal typing.
  if (ordinary.length > 0 && !alt && !ctrl && !shift && !meta) return true;
  if (one && ordinary.length === 1 && ctrl && !shift && !alt && !meta) return true;
  if (one && ordinary.length === 1 && shift && !ctrl && !alt && !meta) return true;
  if (others.length === 0 && leftAlt && shift && !ctrl && !meta) return true;
  if (one && leftAlt && leftAltWindowKeys.includes(others[0])) return true;
  if (one && meta) return true;
  return ctrl && alt && others.includes('delete');
}

/**
 * Adds a key the shortcut editor saw go down. AltGr layouts send a left Ctrl just before
 * Right Alt; Yap Yap's own hook drops it, so the editor must not record it either.
 */
export function addCapturedKey(pressed: Map<string, number>, key: string, time: number): void {
  if (pressed.has(key)) return;
  const ctrlTime = pressed.get('Left Ctrl');
  if (key === 'Right Alt' && ctrlTime !== undefined && time - ctrlTime <= 50) pressed.delete('Left Ctrl');
  pressed.set(key, time);
}
