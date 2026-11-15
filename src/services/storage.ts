import { removeDuplicateShortcuts } from '../../electron/shortcutBindings';
import {
  DEFAULT_SETTINGS,
  INITIAL_DICTIONARY,
  createInitialHistory,
} from '../data/seedData';
import { createDefaultProviders, PROVIDER_CATALOG } from './providers/catalog';
import { assignHistoryIds } from './historyImport';
import { parseRetainedStyles, parseSourceCategories, parseStyleCorrections, parseWritingPreferences } from './personalization';
import {
  DictionaryEntry,
  HistoryItem,
  StyleCorrections,
  ProviderConfig,
  ProviderId,
  SettingsState,
} from '../types/app';

export interface PersistedAppState {
  settings: SettingsState;
  providers: Record<ProviderId, ProviderConfig>;
  history: HistoryItem[];
  dictionary: DictionaryEntry[];
}

const STORAGE_KEY = 'yapyap_app_state_v2';
const LEGACY_STORAGE_KEY = 'yapyap_app_state_v1';
const IDB_NAME = 'yapyap_local_db';
const IDB_STORE = 'app_state';
const IDB_KEY = 'root';

const LEGACY_SEED_DICT_IDS = new Set([
  'd1',
  'd2',
  'd3',
  'd4',
  'd5',
  'd6',
  'd7',
  'd8',
]);

export function getInitialState(): PersistedAppState {
  return {
    settings: DEFAULT_SETTINGS,
    providers: createDefaultProviders(),
    history: createInitialHistory(),
    dictionary: INITIAL_DICTIONARY,
  };
}

function openLocalIndexedDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readFromIndexedDb(): Promise<Partial<PersistedAppState> | null> {
  const db = await openLocalIndexedDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(IDB_KEY);
      req.onsuccess = () => {
        db.close();
        resolve((req.result as Partial<PersistedAppState>) ?? null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

async function writeToIndexedDb(state: PersistedAppState): Promise<void> {
  const db = await openLocalIndexedDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(state, IDB_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

const DEPRECATED_STT_MIGRATIONS: Partial<Record<ProviderId, Record<string, string>>> = {
  openai: {
    'whisper-1': 'gpt-transcribe',
    'gpt-4o-mini-transcribe': 'gpt-transcribe',
    'gpt-4o-transcribe': 'gpt-transcribe',
  },
  elevenlabs: {
    scribe_v1: 'scribe_v3',
  },
  gemini: {
    'gemini-1.5-flash': 'gemini-3.5-flash-lite',
    'gemini-2.0-flash': 'gemini-3.5-flash-lite',
    'gemini-2.5-flash': 'gemini-3.5-flash-lite',
    'gemini-2.5-flash-lite': 'gemini-3.5-flash-lite',
    'gemini-3.5-flash': 'gemini-3.5-flash-lite',
    'gemini-3.7-flash': 'gemini-3.8-flash',
  },
};

const DEPRECATED_LLM_MIGRATIONS: Partial<Record<ProviderId, Record<string, string>>> = {
  openai: {
    'gpt-4o-mini': 'gpt-6-luna',
    'gpt-4o': 'gpt-6-luna',
    'gpt-4.1-mini': 'gpt-6-luna',
    'gpt-4.1': 'gpt-6.1-terra',
    'gpt-5-mini': 'gpt-6-luna',
  },
  groq: {
    'llama-3.3-70b-versatile': 'openai/gpt-oss-20b',
    'llama-3.1-8b-instant': 'openai/gpt-oss-20b',
    'qwen-qwq-32b': 'openai/gpt-oss-20b',
    'qwen/qwen3-32b': 'qwen/qwen3.8-27b',
    'qwen/qwen3.6-27b': 'qwen/qwen3.8-27b',
    'meta-llama/llama-4-scout-17b-16e-instruct': 'openai/gpt-oss-20b',
    'meta-llama/llama-4-maverick-17b-128e-instruct': 'openai/gpt-oss-120b',
  },
  gemini: {
    'gemini-1.5-pro': 'gemini-3.8-flash',
    'gemini-2.0-flash': 'gemini-3.8-flash',
    'gemini-2.5-flash': 'gemini-3.8-flash',
    'gemini-2.5-pro': 'gemini-3.8-flash',
    'gemini-3.5-flash': 'gemini-3.8-flash',
    'gemini-3.7-flash': 'gemini-3.8-flash',
  },
  anthropic: {
    'claude-3-5-haiku-latest': 'claude-haiku-5-5',
    'claude-3-5-haiku-20241022': 'claude-haiku-5-5',
    'claude-3-7-sonnet-latest': 'claude-sonnet-5-5',
    'claude-3-7-sonnet-20250219': 'claude-sonnet-5-5',
    'claude-sonnet-4-20250514': 'claude-sonnet-5-5',
    'claude-opus-4-20250514': 'claude-opus-5-5',
    'claude-haiku-4-5': 'claude-haiku-5-5',
    'claude-sonnet-4-5': 'claude-sonnet-5-5',
  },
  custom: {
    'meta-llama/llama-3.3-70b-instruct:free': 'openrouter/free',
    'openai/gpt-4o-mini': 'openai/gpt-6-luna',
  },
};

function migrateModelId(
  map: Record<string, string> | undefined,
  currentModel: string | undefined,
  fallbackModel: string
): string {
  const model = currentModel?.trim();
  if (!model) return fallbackModel;
  return map?.[model] ?? model;
}

export function sanitizeLoadedState(
  raw: Partial<PersistedAppState> | null
): PersistedAppState {
  const fallback = getInitialState();
  if (!raw) return fallback;

  const defaultProviders = createDefaultProviders();
  const mergedProviders = { ...defaultProviders };
  if (raw.providers) {
    for (const id of Object.keys(defaultProviders) as ProviderId[]) {
      if (raw.providers[id]) {
        const stored = raw.providers[id];
        mergedProviders[id] = {
          ...defaultProviders[id],
          ...stored,
          sttModel: migrateModelId(
            stored.modelsSelected ? undefined : DEPRECATED_STT_MIGRATIONS[id],
            stored.sttModel,
            defaultProviders[id].sttModel
          ),
          llmModel: migrateModelId(
            stored.modelsSelected ? undefined : DEPRECATED_LLM_MIGRATIONS[id],
            stored.llmModel,
            defaultProviders[id].llmModel
          ),
          status: stored.status !== 'testing' && (stored.apiKey?.trim() || !PROVIDER_CATALOG[id].requiresKey)
            ? stored.status ?? 'idle'
            : 'idle',
        };
      }
    }
  }

  // Strip any legacy sample history items so only real user dictations are kept
  const realHistory = Array.isArray(raw.history)
    ? raw.history.filter(
        (item) =>
          item &&
          !item.isSample &&
          !String(item.id).startsWith('h-seed-') &&
          !String(item.id).startsWith('h-today-') &&
          !String(item.id).startsWith('h-prev')
      )
    : [];

  // Strip any legacy sample dictionary items (d1..d8)
  const realDictionary = Array.isArray(raw.dictionary)
    ? raw.dictionary.filter(
        (entry) => entry && !LEGACY_SEED_DICT_IDS.has(String(entry.id))
      )
    : [];

  return {
    settings: {
      ...DEFAULT_SETTINGS,
      ...(raw.settings ?? {}),
      writingPreferences: parseWritingPreferences(raw.settings?.writingPreferences).join('\n'),
      styleCorrections: stampStyleCorrections(parseStyleCorrections(raw.settings?.styleCorrections)),
      retainedStyleSamples: parseRetainedStyles(raw.settings?.retainedStyleSamples),
      sourceCategories: parseSourceCategories(raw.settings?.sourceCategories),
      shortcuts: removeDuplicateShortcuts({
        ...DEFAULT_SETTINGS.shortcuts,
        ...(raw.settings?.shortcuts ?? {}),
      }, typeof window === 'undefined' ? undefined : window.yapyap?.platform),
    },
    providers: mergedProviders,
    history: assignHistoryIds(realHistory),
    dictionary: realDictionary,
  };
}

/**
 * Corrections saved before they carried a date count from now, so update suggestions only
 * look at dictations made after this point, never at the habits that were corrected.
 */
function stampStyleCorrections(corrections: StyleCorrections): StyleCorrections {
  const now = new Date().toISOString();
  return Object.fromEntries(Object.entries(corrections).map(([category, correction]) => [category, { since: now, ...correction }]));
}

// Audio the desktop store already has on disk, by dictation id.
const audioOnDisk = new Map<string, string>();

function rememberAudioOnDisk(history: unknown) {
  if (!Array.isArray(history)) return;
  for (const item of history as Array<{ id?: unknown; audioDataUrl?: unknown }>) {
    if (typeof item?.id === 'string' && typeof item.audioDataUrl === 'string') audioOnDisk.set(item.id, item.audioDataUrl);
  }
}

/**
 * Sending every recording on each save froze the desktop app's main process for a
 * quarter of a second, long enough for a lone Alt press to reach the focused app
 * and open its menu. Audio already on disk is sent as a marker instead.
 */
export function withoutSavedAudio(state: PersistedAppState): PersistedAppState {
  return {
    ...state,
    history: state.history.map((item) =>
      item.audioDataUrl && audioOnDisk.get(item.id) === item.audioDataUrl
        ? { ...item, audioDataUrl: undefined, audioSaved: true }
        : item,
    ),
  };
}

export async function loadPersistedState(): Promise<PersistedAppState> {
  try {
    let raw: Partial<PersistedAppState> | null = null;

    if (typeof window !== 'undefined' && window.yapyap?.loadStore) {
      raw = (await window.yapyap.loadStore()) as Partial<PersistedAppState> | null;
      rememberAudioOnDisk(raw?.history);
    }

    if (!raw) {
      raw = await readFromIndexedDb();
    }

    if (!raw && typeof localStorage !== 'undefined') {
      const local =
        localStorage.getItem(STORAGE_KEY) ??
        localStorage.getItem(LEGACY_STORAGE_KEY);
      if (local) {
        raw = JSON.parse(local) as Partial<PersistedAppState>;
      }
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }

    return sanitizeLoadedState(raw);
  } catch {
    return getInitialState();
  }
}

export async function savePersistedState(state: PersistedAppState): Promise<void> {
  // 1. Save full state (including audio blobs) to IndexedDB in browser
  await writeToIndexedDb(state);

  // 2. Save lightweight copy to localStorage as instant fallback
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      const lightHistory = state.history.map((h) => ({
        ...h,
        audioDataUrl: undefined,
      }));
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ...state, history: lightHistory })
        );
      } catch {
        // ignore quota error
      }
    }
  }

  // 3. Save to Electron userData filesystem store when running as desktop app
  if (typeof window !== 'undefined' && window.yapyap?.saveStore) {
    try {
      const saved = await window.yapyap.saveStore(withoutSavedAudio(state) as unknown as Record<string, unknown>);
      if (saved !== false) rememberAudioOnDisk(state.history);
    } catch {
      // ignore
    }
  }
}
