import {
  DEFAULT_SETTINGS,
  INITIAL_DICTIONARY,
  createInitialHistory,
} from '../data/seedData';
import { createDefaultProviders } from './providers/catalog';
import {
  DictionaryEntry,
  HistoryItem,
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
        mergedProviders[id] = {
          ...defaultProviders[id],
          ...raw.providers[id],
          status: raw.providers[id].apiKey
            ? raw.providers[id].status ?? 'idle'
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
      shortcuts: {
        ...DEFAULT_SETTINGS.shortcuts,
        ...(raw.settings?.shortcuts ?? {}),
      },
      categoryInstructions: {
        ...DEFAULT_SETTINGS.categoryInstructions,
        ...(raw.settings?.categoryInstructions ?? {}),
      },
    },
    providers: mergedProviders,
    history: realHistory,
    dictionary: realDictionary,
  };
}

export async function loadPersistedState(): Promise<PersistedAppState> {
  try {
    let raw: Partial<PersistedAppState> | null = null;

    if (typeof window !== 'undefined' && window.yapyap?.loadStore) {
      raw = (await window.yapyap.loadStore()) as Partial<PersistedAppState> | null;
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
      await window.yapyap.saveStore(state as unknown as Record<string, unknown>);
    } catch {
      // ignore
    }
  }
}
