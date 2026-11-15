import type { ShortcutGroup } from '../../electron/shortcutBindings';

export type ProviderId =
  | 'openai'
  | 'groq'
  | 'gemini'
  | 'anthropic'
  | 'deepgram'
  | 'elevenlabs'
  | 'custom';

export type DictationMode = 'dictate' | 'translate' | 'ask';

export type AppearanceMode = 'light' | 'dark' | 'system';

export type RetentionPolicy = 'forever' | '1y' | '90d' | '30d' | '7d' | '24h' | 'never';

export type PersonalizationCategory =
  | 'AI assistants'
  | 'Messaging'
  | 'Social platforms'
  | 'Development tools';

export interface ProviderModel {
  id: string;
  label: string;
}

export interface ProviderModels {
  speech: ProviderModel[];
  ai: ProviderModel[];
}

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  apiKey: string;
  baseUrl?: string;
  sttModel: string;
  llmModel: string;
  status: 'idle' | 'testing' | 'connected' | 'error';
  statusMessage?: string;
  lastTestedAt?: string;
  discoveredModels?: ProviderModels;
  modelsSelected?: boolean;
}

export interface HistoryItem {
  id: string;
  createdAt: string; // ISO string
  mode: DictationMode;
  rawText: string;
  text: string;
  answer?: string;
  targetLanguage?: string;
  durationMs: number;
  wordCount: number;
  wpm: number;
  providerId: ProviderId;
  model: string;
  audioDataUrl?: string;
  audioMimeType?: string;
  flagged?: boolean;
  category?: PersonalizationCategory;
  isSample?: boolean;
  writingSample?: WritingSample;
  writingCorrection?: boolean;
  /** When the user edited this dictation by hand. Later than createdAt for an older dictation. */
  writingCorrectedAt?: string;
  /** Set when a recording produced no transcript. The audio is kept so it can be retried. */
  outcome?: 'silent' | 'cancelled';
  /** Site or app the dictation was written into. */
  writingSource?: string;
}

/**
 * A learned style sample kept after its History item was deleted or expired, so clearing History
 * does not erase what Yap Yap learned. Holds no transcript text or audio.
 */
export interface RetainedStyleSample {
  /** The History item it came from. */
  id: string;
  createdAt: string;
  writingSample: WritingSample;
  writingCorrection?: boolean;
  writingCorrectedAt?: string;
}

export interface WritingSample {
  category: string;
  tone: string;
  phrasing: string;
  /**
   * The phrasing was read from text the user wrote at the destination. Otherwise it describes the
   * speech recognizer's output, so only the tone and category count.
   */
  fromUserText?: boolean;
}

export interface DictionaryEntry {
  id: string;
  word: string;
  source: 'auto' | 'manual';
  createdAt: string;
}

/** Per category, only the parts the user corrected. The rest of the style keeps learning. */
export type StyleCorrections = Record<string, {
  tone?: string;
  phrasing?: string;
  /** When the user last corrected or confirmed it. Later dictations can suggest an update. */
  since?: string;
  /**
   * Styles the user turned down: what was learned before the correction, and suggestions they
   * declined. Speech keeps showing those habits, so they are never suggested again.
   */
  rejected?: { tones?: string[]; phrasings?: string[] };
}>;

export interface SettingsState {
  shortcuts: ShortcutGroup;
  interfaceLanguage: string;
  translationTargets: string[];
  languageVariants: string[];
  microphoneId: string;
  interactionSounds: boolean;
  muteWhenDictating: boolean;
  appearance: AppearanceMode;
  launchAtLogin: boolean;
  autoPaste: boolean;
  smartCleanup: boolean;
  personalizationEnabled: boolean;
  writingPreferences: string;
  /** The user's corrections to learned styles, by category. They replace what was learned. */
  styleCorrections: StyleCorrections;
  /** Learned style samples whose History items are gone. Kept until the user resets learned style. */
  retainedStyleSamples: RetainedStyleSample[];
  /**
   * The user's category for an app or site (by domain or app name), or "off" to not learn style
   * there. Wins over the built-in rules and over what was learned.
   */
  sourceCategories: Record<string, string>;
  contextAwareness: boolean;
  /** Watch fixes made right after a paste to learn style and dictionary words. */
  learnFromEdits: boolean;
  floatingHud: boolean;
  historyRetention: RetentionPolicy;
  cloudSyncMock: boolean;
  activeSttProvider: ProviderId;
  activeLlmProvider: ProviderId | 'none';
  dismissedQuickCard: boolean;
  dismissedPromoCard: boolean;
}

export type ActiveNav = 'home' | 'history' | 'dictionary';

export type SettingsModalTab =
  | 'providers'
  | 'settings'
  | 'personalization'
  | 'about'
  | 'help';
