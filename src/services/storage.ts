import {
  DEFAULT_SETTINGS,
  SEED_DICTIONARY,
  createSeedHistory,
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

const STORAGE_KEY = 'yapyap_app_state_v1';

export function getInitialState(): PersistedAppState {
  return {
    settings: DEFAULT_SETTINGS,
    providers: createDefaultProviders(),
    history: createSeedHistory(),
    dictionary: SEED_DICTIONARY,
  };
}

export async function loadPersistedState(): Promise<PersistedAppState> {
  const fallback = getInitialState();
  try {
    let raw: Partial<PersistedAppState> | null = null;
    if (window.yapyap?.loadStore) {
      raw = (await window.yapyap.loadStore()) as Partial<PersistedAppState> | null;
    }
    if (!raw) {
      const local = localStorage.getItem(STORAGE_KEY);
      if (local) raw = JSON.parse(local) as Partial<PersistedAppState>;
    }
    if (!raw) return fallback;

    const defaultProviders = createDefaultProviders();
    const mergedProviders = { ...defaultProviders };
    if (raw.providers) {
      for (const id of Object.keys(defaultProviders) as ProviderId[]) {
        if (raw.providers[id]) {
          mergedProviders[id] = {
            ...defaultProviders[id],
            ...raw.providers[id],
            status: raw.providers[id].apiKey ? raw.providers[id].status ?? 'idle' : 'idle',
          };
        }
      }
    }

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
      history: Array.isArray(raw.history) ? raw.history : fallback.history,
      dictionary: Array.isArray(raw.dictionary) ? raw.dictionary : fallback.dictionary,
    };
  } catch {
    return fallback;
  }
}

export async function savePersistedState(state: PersistedAppState): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage quota errors for large audio blobs in localStorage
    const lightHistory = state.history.map((h) => ({ ...h, audioDataUrl: undefined }));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, history: lightHistory }));
    } catch {
      // ignore
    }
  }
  if (window.yapyap?.saveStore) {
    try {
      await window.yapyap.saveStore(state as unknown as Record<string, unknown>);
    } catch {
      // ignore
    }
  }
}
