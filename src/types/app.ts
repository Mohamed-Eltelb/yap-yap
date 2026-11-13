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
  /** Site or app the dictation was written into. */
  writingSource?: string;
}

export interface WritingSample {
  category: string;
  tone: string;
  phrasing: string;
}

export interface DictionaryEntry {
  id: string;
  word: string;
  source: 'auto' | 'manual';
  createdAt: string;
}

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
  contextAwareness: boolean;
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
