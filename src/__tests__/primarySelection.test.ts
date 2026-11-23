import { describe, expect, it } from 'vitest';
import { freshHighlights } from '../../electron/primarySelection';

describe('Linux highlight fallback', () => {
  it('uses a highlight only when it changed since the last Ask', () => {
    const fresh = freshHighlights();
    expect(fresh({ text: 'Quarterly sales rose.' })).toBe('Quarterly sales rose.');
    // Still there at the next Ask: the user moved on, so it is not a selection any more.
    expect(fresh({ text: 'Quarterly sales rose.' })).toBeUndefined();
    expect(fresh({ text: 'npm ERR! missing script' })).toBe('npm ERR! missing script');
  });

  it('uses the same words again only after the owner took the selection again', () => {
    const fresh = freshHighlights();
    expect(fresh({ text: 'same words', stamp: 100 })).toBe('same words');
    expect(fresh({ text: 'same words', stamp: 100 })).toBeUndefined();
    expect(fresh({ text: 'same words', stamp: 200 })).toBe('same words');
    expect(fresh({ text: 'same words', stamp: 200 })).toBeUndefined();
    expect(fresh({ text: 'different words', stamp: 200 })).toBe('different words');
  });

  it('compares only text when either Ask has no timestamp', () => {
    const fresh = freshHighlights();
    expect(fresh({ text: 'same words', stamp: 100 })).toBe('same words');
    expect(fresh({ text: 'same words' })).toBeUndefined();
    expect(fresh({ text: 'same words', stamp: 200 })).toBeUndefined();
    expect(fresh({ text: 'new words' })).toBe('new words');
  });

  it('ignores empty highlights, and remembers them as seen', () => {
    const fresh = freshHighlights();
    expect(fresh({})).toBeUndefined();
    expect(fresh({ text: '  \n' })).toBeUndefined();
    expect(fresh({ text: '' })).toBeUndefined();
    expect(fresh({ text: 'new text' })).toBe('new text');
  });
});
