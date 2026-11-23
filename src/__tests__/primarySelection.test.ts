import { describe, expect, it } from 'vitest';
import { freshHighlights } from '../../electron/primarySelection';

describe('Linux highlight fallback', () => {
  it('uses a highlight only when it changed since the last Ask', () => {
    const fresh = freshHighlights();
    expect(fresh('Quarterly sales rose.')).toBe('Quarterly sales rose.');
    // Still there at the next Ask: the user moved on, so it is not a selection any more.
    expect(fresh('Quarterly sales rose.')).toBeUndefined();
    expect(fresh('npm ERR! missing script')).toBe('npm ERR! missing script');
  });

  it('ignores empty highlights, and remembers them as seen', () => {
    const fresh = freshHighlights();
    expect(fresh(undefined)).toBeUndefined();
    expect(fresh('  \n')).toBeUndefined();
    expect(fresh('')).toBeUndefined();
    expect(fresh('new text')).toBe('new text');
  });
});
