import { afterEach, describe, expect, it, vi } from 'vitest';
import { getInitialState, loadPersistedState, savePersistedState } from '../services/storage';
import type { HistoryItem } from '../types/app';

type Saved = { history: Array<Partial<HistoryItem> & { audioSaved?: boolean }> };

function desktopStore(loaded: unknown, result: boolean | undefined = true) {
  const saves: Saved[] = [];
  vi.stubGlobal('window', {
    yapyap: {
      loadStore: vi.fn(async () => loaded),
      saveStore: vi.fn(async (data: Saved) => { saves.push(data); return result; }),
    },
  });
  return saves;
}

const item = (id: string, audioDataUrl?: string) =>
  ({ id, text: id, audioDataUrl, createdAt: new Date().toISOString() }) as unknown as HistoryItem;

describe('Desktop store saves', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends a recording once and a marker after that', async () => {
    const saves = desktopStore(null);
    const state = { ...getInitialState(), history: [item('a', 'data:audio/webm;base64,AAA')] };
    await savePersistedState(state);
    await savePersistedState(state);
    expect(saves[0].history[0].audioDataUrl).toBe('data:audio/webm;base64,AAA');
    expect(saves[1].history[0]).toMatchObject({ audioDataUrl: undefined, audioSaved: true });
  });

  it('treats recordings loaded from disk as already saved', async () => {
    const loaded = { ...getInitialState(), history: [item('b', 'data:audio/webm;base64,BBB')] };
    const saves = desktopStore(loaded);
    const state = await loadPersistedState();
    await savePersistedState({ ...state, history: [...state.history, item('c', 'data:audio/webm;base64,CCC')] });
    expect(saves[0].history.find((h) => h.id === 'b')).toMatchObject({ audioDataUrl: undefined, audioSaved: true });
    expect(saves[0].history.find((h) => h.id === 'c')?.audioDataUrl).toBe('data:audio/webm;base64,CCC');
  });

  it('resends a recording when the store could not write it', async () => {
    const saves = desktopStore(null, false);
    const state = { ...getInitialState(), history: [item('d', 'data:audio/webm;base64,DDD')] };
    await savePersistedState(state);
    await savePersistedState(state);
    expect(saves[1].history[0].audioDataUrl).toBe('data:audio/webm;base64,DDD');
  });
});
