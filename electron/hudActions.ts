export type HudAction =
  | { type: 'stop' | 'cancel' | 'dismiss' | 'edit-targets' | 'retry' }
  | { type: 'copy'; text: string }
  | { type: 'select-target'; target: string };
