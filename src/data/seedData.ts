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
  spokenLanguages: [],
  microphoneId: 'default',
  interactionSounds: true,
  muteWhenDictating: false,
  strongNoiseReduction: false,
  appearance: 'light',
  launchAtLogin: true,
  autoPaste: true,
  smartCleanup: true,
  personalizationEnabled: true,
  writingPreferences: '',
  styleCorrections: {},
  retainedStyleSamples: [],
  sourceCategories: {},
  contextAwareness: true,
  learnFromEdits: true,
  defaultStyle: '',
  floatingHud: true,
  historyRetention: 'forever',
  cloudSyncMock: false,
  activeSttProvider: 'groq',
  activeLlmProvider: 'groq',
  dismissedQuickCard: false,
  dismissedPromoCard: false,
};

export const INITIAL_DICTIONARY: DictionaryEntry[] = [];

export function createInitialHistory(): HistoryItem[] {
  return [];
}
