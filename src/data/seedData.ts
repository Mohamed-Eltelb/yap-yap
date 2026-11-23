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
  keepOnClipboard: false,
  smartCleanup: true,
  cleanupLevel: 'light',
  personalizationEnabled: true,
  writingPreferences: '',
  styleCorrections: {},
  retainedStyleSamples: [],
  sourceCategories: {},
  contextAwareness: true,
  askAboutSelection: true,
  askCopySelection: true,
  askReplaceSelection: true,
  learnFromEdits: true,
  defaultStyle: '',
  onboardingDone: false,
  floatingHud: true,
  historyRetention: 'forever',
  cloudSyncMock: false,
  activeSttProvider: 'groq',
  activeLlmProvider: 'groq',
  dismissedQuickCard: false,
  dismissedImportCard: false,
};

export const INITIAL_DICTIONARY: DictionaryEntry[] = [];

export function createInitialHistory(): HistoryItem[] {
  return [];
}
