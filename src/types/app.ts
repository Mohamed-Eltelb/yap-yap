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

export type CleanupLevel = 'light' | 'medium';

export interface HistoryItem {
  id: string;
  createdAt: string; // ISO string
  mode: DictationMode;
  rawText: string;
  text: string;
  answer?: string;
  /** The Ask anything answer used a web search. */
  searchedWeb?: boolean;
  /** Ask anything: the text the user selected and asked about, kept so a retry asks about it again. */
  selectedText?: string;
  /** The selected text was cut at the length Yap Yap reads. */
  selectionTruncated?: boolean;
  /** Ask anything: the answer was a rewrite of the selection, made to replace it. */
  rewroteSelection?: boolean;
  targetLanguage?: string;
  durationMs: number;
  wordCount: number;
  wpm: number;
  providerId: ProviderId;
  model: string;
  audioDataUrl?: string;
  /** The recording is in the desktop store; fetch it with loadHistoryAudio when needed. */
  audioSaved?: boolean;
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
  /**
   * A dictation's text without the AI edit, saved when it was made: the recognizer's words with the
   * dictionary spellings and snippets of that time. What "Undo AI edit" shows.
   */
  plainText?: string;
  /** The cleaned-up text, kept while the user has undone the AI edit, so it can be redone. */
  aiText?: string;
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
  /** Read from a fix the user made right after a paste. Counts once another sample agrees. */
  fromEdit?: boolean;
}

export interface DictionaryEntry {
  id: string;
  word: string;
  source: 'auto' | 'manual';
  createdAt: string;
  /** How the recognizer tends to write the word, such as "hand of" for "handoff". Replaced after cleanup. */
  heardAs?: string;
}

/** Saved text inserted when the user says its trigger phrase while dictating. */
export interface Snippet {
  id: string;
  /** What the user says, such as "my signature". */
  trigger: string;
  /** What is pasted instead, exactly as saved, line breaks included. */
  expansion: string;
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
  /** Languages the user speaks, by name ('Arabic'); empty means auto-detect. */
  spokenLanguages: string[];
  microphoneId: string;
  interactionSounds: boolean;
  muteWhenDictating: boolean;
  /** Runs the microphone through RNNoise, for noisy places. Off by default. */
  strongNoiseReduction: boolean;
  appearance: AppearanceMode;
  launchAtLogin: boolean;
  autoPaste: boolean;
  /** Leaves the dictation on the clipboard after delivery. Off restores what was there before. */
  keepOnClipboard: boolean;
  /** Whether AI cleanup runs on dictations. Off is the "None" level. */
  smartCleanup: boolean;
  /** How much cleanup edits when on: Light fixes, Medium may also reword for clarity. */
  cleanupLevel: CleanupLevel;
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
  /** Ask anything reads the text selected in the app in front and answers about it. */
  askAboutSelection: boolean;
  /** When an app doesn't share its selection, copy it with Ctrl+C and put the clipboard back (Windows). */
  askCopySelection: boolean;
  /** When the user asks to rewrite text selected in a field they can edit, paste the rewrite over it. */
  askReplaceSelection: boolean;
  /** Watch fixes made right after a paste to learn style and dictionary words. */
  learnFromEdits: boolean;
  /** A style preset id for places with no style picked or learned, or '' to learn only. */
  defaultStyle: string;
  /** First-run setup was finished or skipped. */
  onboardingDone: boolean;
  floatingHud: boolean;
  historyRetention: RetentionPolicy;
  cloudSyncMock: boolean;
  activeSttProvider: ProviderId;
  activeLlmProvider: ProviderId | 'none';
  dismissedQuickCard: boolean;
  /** The sidebar offer to import from Wispr Flow or Typeless was dismissed or used. */
  dismissedImportCard: boolean;
}

export type ActiveNav = 'home' | 'history' | 'dictionary' | 'snippets';

export type SettingsModalTab =
  | 'providers'
  | 'settings'
  | 'personalization'
  | 'about'
  | 'help';
