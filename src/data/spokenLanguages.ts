/**
 * Languages the user can say they speak. An empty choice means auto-detect.
 * code: ISO 639-1, which Whisper, Deepgram and ElevenLabs all accept.
 * phrase: a short line in the language itself. Whisper reads its prompt as text spoken
 * before the audio and tends to answer in that text's language, so each language is
 * primed in its own words rather than named in English.
 */
export const SPOKEN_LANGUAGES = [
  { name: 'Afrikaans', native: 'Afrikaans', code: 'af', phrase: 'Ek praat Afrikaans.' },
  { name: 'Albanian', native: 'shqip', code: 'sq', phrase: 'Unë flas shqip.' },
  { name: 'Amharic', native: 'አማርኛ', code: 'am', phrase: 'አማርኛ እናገራለሁ።' },
  { name: 'Arabic', native: 'العربية', code: 'ar', phrase: 'أنا بتكلم عربي.' },
  { name: 'Chinese', native: '中文', code: 'zh', phrase: '我说中文。' },
  { name: 'Dutch', native: 'Nederlands', code: 'nl', phrase: 'Ik spreek Nederlands.' },
  { name: 'English', native: 'English', code: 'en', phrase: 'I speak English.' },
  { name: 'French', native: 'français', code: 'fr', phrase: 'Je parle français.' },
  { name: 'German', native: 'Deutsch', code: 'de', phrase: 'Ich spreche Deutsch.' },
  { name: 'Hindi', native: 'हिन्दी', code: 'hi', phrase: 'मैं हिंदी बोलता हूँ।' },
  { name: 'Indonesian', native: 'Bahasa Indonesia', code: 'id', phrase: 'Saya berbicara bahasa Indonesia.' },
  { name: 'Italian', native: 'italiano', code: 'it', phrase: 'Parlo italiano.' },
  { name: 'Japanese', native: '日本語', code: 'ja', phrase: '日本語を話します。' },
  { name: 'Korean', native: '한국어', code: 'ko', phrase: '한국어를 합니다.' },
  { name: 'Persian', native: 'فارسی', code: 'fa', phrase: 'من فارسی صحبت می‌کنم.' },
  { name: 'Polish', native: 'polski', code: 'pl', phrase: 'Mówię po polsku.' },
  { name: 'Portuguese', native: 'português', code: 'pt', phrase: 'Eu falo português.' },
  { name: 'Russian', native: 'русский', code: 'ru', phrase: 'Я говорю по-русски.' },
  { name: 'Spanish', native: 'español', code: 'es', phrase: 'Hablo español.' },
  { name: 'Turkish', native: 'Türkçe', code: 'tr', phrase: 'Türkçe konuşuyorum.' },
  { name: 'Ukrainian', native: 'українська', code: 'uk', phrase: 'Я розмовляю українською.' },
  { name: 'Urdu', native: 'اردو', code: 'ur', phrase: 'میں اردو بولتا ہوں۔' },
  { name: 'Vietnamese', native: 'Tiếng Việt', code: 'vi', phrase: 'Tôi nói tiếng Việt.' },
] as const;

type SpokenLanguage = (typeof SPOKEN_LANGUAGES)[number];

export type SpeechLanguages = {
  /** The languages the user picked; empty on auto-detect. */
  languages: SpokenLanguage[];
  /** The preferred dialects of those languages, such as "Arabic (Egypt)". */
  dialects: string[];
};

/** Resolves the user's choice; dialects come from Language variants, kept only for spoken languages. */
export function speechLanguages(spoken: string[] | undefined, variants: string[] = []): SpeechLanguages {
  const languages = SPOKEN_LANGUAGES.filter((language) => spoken?.includes(language.name));
  const dialects = variants.filter((variant) =>
    languages.some((language) => variant.includes(language.name)));
  return { languages, dialects };
}
