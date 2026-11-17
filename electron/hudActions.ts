export type HudAction =
  | { type: 'stop' | 'cancel' | 'pause' | 'resume' | 'undo' | 'dismiss' | 'edit-targets' | 'retry' }
  | { type: 'copy'; text: string }
  | { type: 'select-target'; target: string };

/** What a hook shortcut press asks the HUD to show. */
export type ShortcutPhase = 'armed' | 'list' | 'closed' | 'busy';
