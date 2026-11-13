import {
  DictionaryEntry,
  HistoryItem,
  SettingsState,
} from '../types/app';

export const DEFAULT_SETTINGS: SettingsState = {
  shortcuts: {
    dictate: [['Right Alt']],
    translate: [['Right Alt', 'Right Shift']],
    ask: [['Right Alt', 'Space']],
  },
  interfaceLanguage: 'English (US)',
  translationTargets: ['Arabic (Egypt)', 'English (US)'],
  languageVariants: ['English (US)', 'Arabic (Egypt)'],
  microphoneId: 'default',
  interactionSounds: true,
  muteWhenDictating: false,
  appearance: 'light',
  launchAtLogin: true,
  autoPaste: true,
  smartCleanup: true,
  personalizationEnabled: true,
  floatingHud: true,
  historyRetention: 'forever',
  cloudSyncMock: false,
  activeSttProvider: 'groq',
  activeLlmProvider: 'groq',
  categoryInstructions: {
    'AI assistants': 'Preserve technical precision, clear prompts, and structured formatting.',
    Messaging: 'Keep tone conversational, natural, and concise.',
    'Social platforms': 'Keep sentences punchy and readable.',
    'Development tools': 'Preserve camelCase, snake_case, CLI flags, and code identifiers verbatim.',
  },
  dismissedQuickCard: false,
  dismissedPromoCard: false,
};

export const INITIAL_DICTIONARY: DictionaryEntry[] = [];

export function createInitialHistory(): HistoryItem[] {
  return [];
}
