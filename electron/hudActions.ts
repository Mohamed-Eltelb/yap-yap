export type HudAction =
  | { type: 'stop' | 'cancel' | 'undo' | 'dismiss' | 'edit-targets' | 'retry' }
  | { type: 'copy'; text: string }
  | { type: 'select-target'; target: string };

/** What a hook shortcut press asks the HUD to show. */
export type ShortcutPhase = 'armed' | 'list' | 'closed' | 'busy';
