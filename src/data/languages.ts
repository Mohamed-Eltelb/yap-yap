export const TRANSLATION_LANGUAGES = [
  ['Afrikaans', 'Afrikaans'],
  ['Albanian', 'shqip'],
  ['Amharic', 'አማርኛ'],
  ['Arabic (Egypt)', 'العربية (مصر)'],
  ['Arabic (MSA)', 'العربية الفصحى'],
  ['Arabic (Saudi Arabia)', 'العربية (السعودية)'],
  ['Chinese (Simplified)', '简体中文'],
  ['English (UK)', 'English (UK)'],
  ['English (US)', 'English (US)'],
  ['French', 'français'],
  ['German', 'Deutsch'],
  ['Hindi', 'हिन्दी'],
  ['Italian', 'italiano'],
  ['Japanese', '日本語'],
  ['Korean', '한국어'],
  ['Portuguese', 'português'],
  ['Spanish', 'español'],
  ['Turkish', 'Türkçe'],
] as const;

interface VariantGroup {
  language: string;
  options: readonly [string, ...string[]];
  legacy?: string;
}

export const LANGUAGE_VARIANTS: readonly [VariantGroup, ...VariantGroup[]] = [
  { language: 'English', options: ['English (US)', 'English (UK)', 'English (AU)', 'English (CA)'] },
  {
    language: 'Chinese',
    options: ['Simplified Chinese (Mainland China)', 'Traditional Chinese (Hong Kong)', 'Traditional Chinese (Taiwan)'],
    legacy: 'Chinese (Simplified)',
  },
  { language: 'Spanish', options: ['Spanish (Mexico)', 'Spanish (Spain)', 'Spanish (United States)'], legacy: 'Spanish' },
  { language: 'French', options: ['French (France)', 'French (Canada)'], legacy: 'French' },
  { language: 'Portuguese', options: ['Portuguese (Portugal)', 'Portuguese (Brazil)'], legacy: 'Portuguese' },
];

function belongsTo(group: VariantGroup, value: string) {
  return value === group.legacy || group.options.includes(value);
}

export function getLanguageVariant(group: VariantGroup, saved: string[]) {
  const variant = saved.find((value) => belongsTo(group, value));
  return variant && variant !== group.legacy ? variant : group.options[0];
}

export function setLanguageVariant(group: VariantGroup, saved: string[], variant: string) {
  return [...saved.filter((value) => !belongsTo(group, value)), variant];
}

export function getPreferredLanguageVariants(saved: string[]) {
  return [
    ...LANGUAGE_VARIANTS.map((group) => getLanguageVariant(group, saved)),
    ...saved.filter((value) => !LANGUAGE_VARIANTS.some((group) => belongsTo(group, value))),
  ];
}
