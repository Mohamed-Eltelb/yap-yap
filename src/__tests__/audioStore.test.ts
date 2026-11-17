import { describe, expect, it } from 'vitest';
import { isAudioId, markSavedAudio } from '../../electron/audioStore';

describe('Desktop audio store', () => {
  it('marks dictations whose recording is on disk instead of reading them', () => {
    const history: Array<{ id: string; audioSaved?: boolean; audioDataUrl?: string }> = [{ id: 'a' }, { id: 'b' }, { id: 'c', audioDataUrl: 'data:x' }];
    markSavedAudio(history, new Set(['a.txt', 'c.txt']));
    expect(history).toEqual([{ id: 'a', audioSaved: true }, { id: 'b' }, { id: 'c', audioDataUrl: 'data:x' }]);
  });

  it('accepts only plain dictation ids as recording names', () => {
    expect(isAudioId('h-1763384400000-ab12')).toBe(true);
    expect(isAudioId('../yapyap-store')).toBe(false);
    expect(isAudioId('a/b')).toBe(false);
    expect(isAudioId('')).toBe(false);
  });
});
