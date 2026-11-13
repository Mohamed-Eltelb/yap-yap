import { describe, expect, it } from 'vitest';
import {
  LANGUAGE_VARIANTS,
  getLanguageVariant,
  getPreferredLanguageVariants,
  setLanguageVariant,
} from '../data/languages';

describe('language variants', () => {
  it('recognizes a saved Chinese label and supplies defaults for the other rows', () => {
    expect(getLanguageVariant(LANGUAGE_VARIANTS[1], ['Chinese (Simplified)']))
      .toBe('Simplified Chinese (Mainland China)');
    expect(getPreferredLanguageVariants([])).toEqual([
      'English (US)',
      'Simplified Chinese (Mainland China)',
      'Spanish (Mexico)',
      'French (France)',
      'Portuguese (Portugal)',
    ]);
  });

  it('replaces older choices for one language and keeps unrelated preferences', () => {
    const saved = ['Arabic (Egypt)', 'English (US)', 'English (UK)', 'French'];
    const updated = setLanguageVariant(LANGUAGE_VARIANTS[0], saved, 'English (CA)');
    expect(updated).toEqual(['Arabic (Egypt)', 'French', 'English (CA)']);
    expect(getPreferredLanguageVariants(updated)).toContain('Arabic (Egypt)');
  });
});
