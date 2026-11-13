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
  let chords: string[][] = [[]];
  for (const key of normalized) {
    const options = Object.hasOwn(sidedModifiers, key)
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
