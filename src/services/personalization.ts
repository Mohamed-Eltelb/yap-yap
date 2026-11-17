import type { DictionaryEntry, HistoryItem, RetainedStyleSample, Snippet, StyleCorrections, WritingSample } from '../types/app';

export const WRITING_CATEGORIES = [
  'AI assistants',
  'Messaging',
  'Email',
  'Social platforms',
  'Document editors',
  'Development tools',
  'Project management',
  'Presentations',
  'Spreadsheets',
  'Data analytics',
  'Form builders',
] as const;

export type WritingCategory = (typeof WRITING_CATEGORIES)[number];

export const WRITING_TONES = ['Casual', 'Friendly', 'Neutral', 'Professional', 'Formal', 'Direct', 'Enthusiastic'] as const;

// Domain rules are tested first. App rules apply only when no domain was captured.
const destinationRules: [WritingCategory, domain: RegExp, application: RegExp][] = [
  ['Form builders', /^(forms\.google\.com|forms\.gle|forms\.office\.com)$|(^|\.)(typeform\.com|tally\.so|jotform\.com)$/, /^$/],
  ['Data analytics', /^(analytics|lookerstudio)\.google\.com$|(^|\.)(powerbi\.com|tableau\.com|mixpanel\.com|amplitude\.com|metabase\.com)$/, /power bi|tableau/],
  ['Spreadsheets', /^sheets\.google\.com$|(^|\.)(airtable\.com|excel\.cloud\.microsoft)$/, /excel|numbers|libreoffice calc/],
  ['Presentations', /^slides\.google\.com$|(^|\.)(canva\.com|gamma\.app|pitch\.com|powerpoint\.cloud\.microsoft)$/, /powerpoint|keynote/],
  ['AI assistants', /(^|\.)(chatgpt\.com|openai\.com|claude\.ai|perplexity\.ai|grok\.com|deepseek\.com|poe\.com|mistral\.ai)$|^(gemini|aistudio)\.google\.com$|^copilot\.microsoft\.com$/, /chatgpt|claude|copilot|perplexity/],
  ['Email', /^mail\.|(^|\.)(outlook\.(live|office|office365)\.com|proton\.me|fastmail\.com|superhuman\.com)$/, /outlook|thunderbird|^mail$|spark/],
  ['Messaging', /(^|\.)(whatsapp\.com|telegram\.org|discord\.com|slack\.com|messenger\.com)$|^teams\.(microsoft|live)\.com$|^(messages|chat)\.google\.com$/, /slack|discord|whatsapp|telegram|teams|signal|messages|messenger|phone link/],
  ['Social platforms', /(^|\.)(x\.com|twitter\.com|linkedin\.com|facebook\.com|instagram\.com|reddit\.com|threads\.(net|com)|bsky\.app|tiktok\.com|youtube\.com|mastodon\.social)$/, /^$/],
  ['Project management', /(^|\.)(linear\.app|atlassian\.net|trello\.com|asana\.com|clickup\.com|monday\.com|basecamp\.com)$/, /linear|jira|trello|asana|clickup/],
  ['Development tools', /(^|\.)(github\.com|gitlab\.com|bitbucket\.org|stackoverflow\.com|vercel\.com|codesandbox\.io|replit\.com)$/, /visual studio|cursor|terminal|powershell|intellij|pycharm|webstorm|rider|android studio|xcode|sublime|neovim|zed|windsurf|iterm|^warp$|antigravity|codex/],
  ['Document editors', /^docs\.google\.com$|(^|\.)(notion\.so|notion\.site|coda\.io|word\.cloud\.microsoft|dropbox\.com)$/, /word|notion|obsidian|notepad|pages|onenote|textedit|writer|wordpad|sticky ?notes/],
];

export interface WritingDestination {
  application: string;
  domain?: string;
}

/** A user's choice for an app or site: a category, or "off" to not learn style there. */
export const DONT_LEARN = 'off';
export type SourceChoice = WritingCategory | typeof DONT_LEARN;
const MAX_SOURCE_CHOICES = 200;

/** Saved app and site choices, keeping known categories and clean keys only. */
export function parseSourceCategories(value: unknown): Record<string, SourceChoice> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const choices: Record<string, SourceChoice> = {};
  for (const [rawKey, rawChoice] of Object.entries(value).slice(0, MAX_SOURCE_CHOICES)) {
    const key = sourceKey(rawKey);
    const choice = rawChoice === DONT_LEARN
      ? DONT_LEARN
      : WRITING_CATEGORIES.find((name) => typeof rawChoice === 'string' && writingCategoryKey(name) === writingCategoryKey(rawChoice));
    if (key && choice) choices[key] = choice;
  }
  return choices;
}

/** The key an app or site is stored under, from what the user typed or what was captured. */
export function sourceKey(value: string): string | undefined {
  const text = value.trim().toLowerCase()
    .replace(/[®™©]/gu, '')
    .replace(/\s+/gu, ' ')
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/^www\./, '')
    .slice(0, 100)
    .trim();
  return text || undefined;
}

/** Whether an app or site key is a website (a domain) rather than an app name. */
export function isWebsiteKey(key: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(key);
}

/** The category the built-in rules give an app or site key, if any. */
export function builtInCategory(key: string): WritingCategory | undefined {
  return isWebsiteKey(key) ? categoryForDestination({ domain: key }) : categoryForDestination({ application: key });
}

export interface DestinationEntry {
  key: string;
  /** What Yap Yap would pick without the user's choice. */
  automatic?: string;
  /** Whether that comes from the built-in rules rather than earlier dictations. */
  builtIn: boolean;
  choice?: SourceChoice;
  uses: number;
}

/** Apps and sites the user dictated into or set a choice for, most used first. */
export function listDestinations(
  items: readonly Pick<HistoryItem, 'writingSource'>[],
  learned: ReadonlyMap<string, string>,
  choices: Readonly<Record<string, SourceChoice>>,
): DestinationEntry[] {
  const uses = new Map<string, number>();
  for (const item of items) {
    const key = learnableSource(item.writingSource);
    if (key) uses.set(key, (uses.get(key) ?? 0) + 1);
  }
  for (const key of Object.keys(choices)) if (!uses.has(key)) uses.set(key, 0);
  return [...uses].flatMap(([key, count]) => {
    const builtIn = builtInCategory(key);
    const entry = { key, automatic: builtIn ?? learned.get(key), builtIn: !!builtIn, choice: choices[key], uses: count };
    // A place used once and unknown (a sign-in page, say) is noise until it comes up again.
    return entry.choice || builtIn || count >= 2 ? [entry] : [];
  }).sort((a, b) => b.uses - a.uses || a.key.localeCompare(b.key));
}

/** Stable name for where a dictation went: the site in a browser, otherwise the app. */
/** Browsers host every kind of site, so without a domain the browser alone says nothing. */
const BROWSER_APPS = /^(?:google chrome|chromium|chrome|microsoft edge|msedge|edge|(?:mozilla )?firefox|brave(?: browser)?|vivaldi|opera(?: gx)?|arc|comet|zen(?: browser)?|safari)$/i;

/**
 * The operating system's own surfaces (Start menu, search, file manager) are not a kind of place
 * the user writes in, so nothing is learned or remembered for them.
 */
const SYSTEM_APPS = /^(?:microsoft windows operating system|windows explorer|file explorer|explorer|windows shell experience host|shellexperiencehost|startmenuexperiencehost|searchhost|searchapp|search|windows search|finder|spotlight|dock|systemuiserver|loginwindow)$/;

/** A stored app or site key, cleaned, or nothing when it is a browser or system surface. */
export function learnableSource(value: string | undefined): string | undefined {
  const key = value ? sourceKey(value) : undefined;
  return key && !SYSTEM_APPS.test(key) && !BROWSER_APPS.test(key) ? key : undefined;
}

export function destinationKey(destination?: Partial<WritingDestination>): string | undefined {
  const domain = destination?.domain?.trim();
  if (domain) return sourceKey(domain);
  return learnableSource(destination?.application);
}

/** Brand names that title case would get wrong. */
const SOURCE_NAMES: Record<string, string> = {
  chatgpt: 'ChatGPT', onenote: 'OneNote', powerpoint: 'PowerPoint', whatsapp: 'WhatsApp', linkedin: 'LinkedIn',
  github: 'GitHub', 'github desktop': 'GitHub Desktop', 'visual studio code': 'Visual Studio Code', vscode: 'VS Code',
  intellij: 'IntelliJ', 'intellij idea': 'IntelliJ IDEA', pycharm: 'PyCharm', webstorm: 'WebStorm', iterm: 'iTerm',
  'microsoft stickynotes': 'Microsoft Sticky Notes', stickynotes: 'Sticky Notes', textedit: 'TextEdit', clickup: 'ClickUp',
};

/** How an app or site key reads in the list: sites as they are, apps in title case. */
export function sourceLabel(key: string): string {
  if (isWebsiteKey(key)) return key;
  return SOURCE_NAMES[key] ?? key.replace(/(^|[\s-])(\p{Ll})/gu, (_, lead: string, letter: string) => lead + letter.toUpperCase());
}

/** Samples a destination needs, mostly agreeing, before its category is trusted without asking the model. */
const SOURCE_MIN_SAMPLES = 3;

/** Categories the model already chose for destinations the built-in rules do not know. */
export function buildSourceCategories(items: readonly Pick<HistoryItem, 'writingSample' | 'writingSource'>[]): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();
  for (const item of items) {
    const category = parseWritingSample(item.writingSample)?.category;
    const source = learnableSource(item.writingSource);
    if (!category || !source) continue;
    const tally = votes.get(source) ?? new Map<string, number>();
    tally.set(category, (tally.get(category) ?? 0) + 1);
    votes.set(source, tally);
  }
  // One early guess must not decide a destination forever: trust it only after several
  // samples, two thirds of them agreeing.
  return new Map([...votes].flatMap(([source, tally]) => {
    const [[category, top]] = [...tally].sort((a, b) => b[1] - a[1]);
    const total = [...tally.values()].reduce((sum, count) => sum + count, 0);
    return total >= SOURCE_MIN_SAMPLES && top * 3 >= total * 2 ? [[source, category] as const] : [];
  }));
}

/**
 * Makes dictated text continue what is already at the caret: a leading space when needed and
 * a lowercase first letter mid-sentence. Runs on the device, with or without an AI provider.
 */
export function fitToSurroundingText(text: string, before: string | undefined, properNouns: readonly string[] = []): string {
  const line = before?.replace(/\r/g, '').split('\n').pop() ?? '';
  if (!text || !line.trim()) return text;
  const lead = /[\s(\[{“‘]$/u.test(line) ? '' : ' ';
  if (/[.!?…。！？]["')\]”’]*\s*$/u.test(line)) return lead + text;
  const first = text.match(/^\p{L}[\p{L}\p{M}'’-]*/u)?.[0];
  const keepCapital = !first
    || /^I(?:['’]|$)/.test(first)
    || /^\p{Lu}{2,}/u.test(first)
    || isWrittenMidSentence(first, before!)
    || properNouns.some((noun) => noun.split(/\s+/)[0] === first);
  return lead + (keepCapital ? text : text[0].toLocaleLowerCase() + text.slice(1));
}

/**
 * Dictionary words for the recognizer and cleanup, the user's own first. Prompts keep only the
 * first few dozen, so learned words must never push out words the user added.
 */
export function dictionaryWordsFor(
  entries: readonly { word: string; source: 'auto' | 'manual' }[],
  includeLearned: boolean,
): string[] {
  const manual = entries.filter((entry) => entry.source === 'manual');
  const learned = includeLearned ? entries.filter((entry) => entry.source !== 'manual') : [];
  return [...manual, ...learned].map((entry) => entry.word);
}

/** A heard-as spelling, cleaned up: one line, single spaces, at most 60 characters. */
export function readHeardAs(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/gu, ' ').trim().slice(0, 60);
  return text || undefined;
}

/** Longest trigger and expansion a snippet can have. */
export const MAX_SNIPPET_TRIGGER = 60;
export const MAX_SNIPPET_EXPANSION = 4000;

/** Cleanup may write a spoken number as digits ("room one hundred five" becomes "room 105"). */
const UNIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS_WORDS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
// What may sit between a trigger's words. Strictly: spaces, hyphens and the like, but no sentence
// punctuation, so "My address: 12 October" is not the trigger "my address 12" (as in Wispr Flow).
// Loosely: anything, for text cleanup may have punctuated differently.
// Sentence punctuation in Latin, Arabic, Urdu, Hindi and East Asian scripts.
const SENTENCE_MARKS = '.,;:!?…،؛؟۔।॥，。、！？；：';
const BETWEEN = { strict: `[^\\p{L}\\p{M}\\p{N}${SENTENCE_MARKS}]`, loose: '[^\\p{L}\\p{M}\\p{N}]' };

/** English words for a whole number below a million, or undefined for larger ones. */
function numberWords(value: number): string[] | undefined {
  if (!Number.isInteger(value) || value < 0 || value >= 1_000_000) return undefined;
  if (value < 20) return [UNIT_WORDS[value]];
  if (value < 100) return [TENS_WORDS[Math.floor(value / 10)], ...(value % 10 ? [UNIT_WORDS[value % 10]] : [])];
  const [size, name] = value < 1000 ? [100, 'hundred'] : [1000, 'thousand'];
  const rest = value % size;
  return [...numberWords(Math.floor(value / size))!, name, ...(rest ? numberWords(rest)! : [])];
}

/** A year said in two pairs: "twenty fifteen", "nineteen oh five", "nineteen hundred". */
function yearWords(value: number): string[] | undefined {
  const head = Math.floor(value / 100);
  const tail = value % 100;
  if (!Number.isInteger(value) || head < 10 || head > 99) return undefined;
  const tailWords = tail === 0 ? ['hundred'] : tail < 10 ? ['oh', UNIT_WORDS[tail]] : numberWords(tail)!;
  return [...numberWords(head)!, ...tailWords];
}

/**
 * Folds spoken numbers into digits: "twenty one" is 21, "one hundred and five" is 105, and years
 * said in pairs, "twenty fifteen" is 2015. Digits said one by one stay apart ("one two" is 1 2),
 * since a unit never follows a unit in a single number.
 */
function foldNumberWords(words: string[]): string[] {
  const out: string[] = [];
  let total = 0;
  let current = 0;
  let last: 'unit' | 'teen' | 'tens' | 'hundred' | 'thousand' | null = null;
  let skip = false;
  const flush = () => {
    if (last) out.push(String(total + current));
    total = 0;
    current = 0;
    last = null;
  };
  words.forEach((word, index) => {
    if (skip) {
      skip = false;
      return;
    }
    // Arabic numbers stand apart from English ones: "عنوان واحد" is "عنوان 1", "واحد وعشرين" is 21.
    const arabic = arabicNumberValue(word);
    const arabicTens = arabicTensValue(word);
    if (arabic >= 0 || arabicTens >= 2) {
      flush();
      const nextTens = arabic > 0 && arabic < 10 ? arabicTensValue(words[index + 1] ?? '') : -1;
      skip = nextTens >= 2 && /^و/u.test(words[index + 1]);
      out.push(String(skip ? nextTens * 10 + arabic : arabic >= 0 ? arabic : arabicTens * 10));
      return;
    }
    const unit = UNIT_WORDS.indexOf(word);
    const tens = TENS_WORDS.indexOf(word);
    const next = UNIT_WORDS.indexOf(words[index + 1] ?? '');
    // A pair from 10 to 99 followed by another pair is a year: "nineteen ninety", "twenty fifteen".
    const yearHead = total === 0 && (last === 'teen' || (last === 'tens' && current % 10 === 0)) && current >= 10;
    if (yearHead && (unit >= 10 || tens > 1)) {
      total = current * 100;
      current = unit >= 10 ? unit : tens * 10;
      last = unit >= 10 ? 'teen' : 'tens';
    } else if (yearHead && word === 'oh' && next > 0 && next < 10) {
      // "nineteen oh five": the unit that follows joins as the last digit.
      total = current * 100;
      current = 0;
      last = 'tens';
    } else if (unit >= 0) {
      const kind = unit < 10 ? 'unit' : 'teen';
      // "twenty one" joins; "one two" or "twenty twelve" do not.
      if (last === 'unit' || last === 'teen' || (last === 'tens' && kind === 'teen')) flush();
      current += unit;
      last = kind;
    } else if (tens > 1) {
      if (last === 'unit' || last === 'teen' || last === 'tens') flush();
      current += tens * 10;
      last = 'tens';
    } else if (word === 'hundred' && last && last !== 'hundred' && current > 0 && current < 10) {
      current *= 100;
      last = 'hundred';
    } else if (word === 'thousand' && last && last !== 'thousand' && current > 0) {
      total += current * 1000;
      current = 0;
      last = 'thousand';
    } else if (word === 'and' && (last === 'hundred' || last === 'thousand') && UNIT_WORDS.concat(TENS_WORDS).includes(words[index + 1] ?? '')) {
      // "one hundred and five": the "and" belongs to the number.
    } else {
      flush();
      out.push(word);
    }
  });
  flush();
  return out;
}

/**
 * Arabic number words from zero to ten, by value, in Modern Standard and Egyptian forms, for both
 * genders. Alef and taa marbuta are matched in their common spellings (see arabicLetters).
 */
const ARABIC_NUMBER_WORDS = [
  ['صفر'],
  ['واحد', 'واحدة'],
  ['اثنان', 'اثنين', 'اثنتان', 'اثنتين', 'اتنين', 'تنين'],
  ['ثلاثة', 'ثلاث', 'تلاتة', 'تلات'],
  ['أربعة', 'أربع'],
  ['خمسة', 'خمس'],
  ['ستة', 'ست'],
  ['سبعة', 'سبع'],
  ['ثمانية', 'ثماني', 'ثمان', 'تمانية', 'تمن'],
  ['تسعة', 'تسع'],
  ['عشرة', 'عشر'],
];

/** Arabic tens from twenty to ninety, by tens digit: "واحد وعشرين" is 21. */
const ARABIC_TENS_WORDS = [
  [], [],
  ['عشرين', 'عشرون'],
  ['ثلاثين', 'ثلاثون', 'تلاتين'],
  ['أربعين', 'أربعون'],
  ['خمسين', 'خمسون'],
  ['ستين', 'ستون'],
  ['سبعين', 'سبعون'],
  ['ثمانين', 'ثمانون', 'تمانين'],
  ['تسعين', 'تسعون'],
];

/** The tens digit of an Arabic tens word, with or without a leading "و" (and). */
function arabicTensValue(word: string): number {
  const plain = sameArabicLetters(word).replace(/^و/u, '');
  return ARABIC_TENS_WORDS.findIndex((forms) => forms.some((form) => sameArabicLetters(form) === plain));
}

/** A number from 0 to 99 as Arabic words, as a pattern: "واحد وعشرين", "عشرين", "خمسة". */
function arabicNumberPattern(value: number, between: string): string | undefined {
  const forms = (list: string[]) => `(?:${list.map(arabicLetters).join('|')})`;
  const tens = Math.floor(value / 10);
  const unit = value % 10;
  // A unit said alone is only that number if no "و" and a tens word follow it.
  const notCompound = `(?!${between}+و${between}*${forms(ARABIC_TENS_WORDS.flat())})`;
  if (value <= 10) return `${forms(ARABIC_NUMBER_WORDS[value])}${notCompound}`;
  if (tens < 2 || tens > 9) return undefined;
  const tensWords = forms(ARABIC_TENS_WORDS[tens]);
  return unit ? `${forms(ARABIC_NUMBER_WORDS[unit])}${between}+و${between}*${tensWords}` : tensWords;
}

/**
 * One Arabic spelling as a pattern, matching the ways the same word is commonly written: any alef
 * form, taa marbuta as haa, alef maqsura as yaa, with or without diacritics and tatweel.
 */
function arabicLetters(word: string): string {
  const variants: Record<string, string> = { ا: '[اأإآ]', أ: '[اأإآ]', إ: '[اأإآ]', آ: '[اأإآ]', ة: '[ةه]', ه: '[ةه]', ى: '[ىي]', ي: '[ىي]' };
  return word.replace(/[ء-ي]/gu, (letter) => `${variants[letter] ?? letter}[\\u064B-\\u0652\\u0670\\u0640]*`);
}

/** Arabic text in one spelling (see arabicLetters), for comparing. */
function sameArabicLetters(text: string): string {
  return text.replace(/[ً-ْٰـ]/gu, '').replace(/[أإآ]/gu, 'ا').replace(/ة/gu, 'ه').replace(/ى/gu, 'ي');
}

/** The value of an Arabic number word, however its alef and taa marbuta are written. */
function arabicNumberValue(word: string): number {
  return ARABIC_NUMBER_WORDS.findIndex((forms) => forms.some((form) => sameArabicLetters(form) === sameArabicLetters(word)));
}

/** Words that make the number before them bigger, in English and Arabic, as a pattern. */
function largerNumberWords(): string {
  const arabic = ['عشر', 'عشرة', 'مية', 'مئة', 'مائة', 'ميت', 'ألف', 'آلاف', 'مليون'].map(arabicLetters);
  return `(?:hundreds?|thousands?|millions?|${arabic.join('|')})(?![\\p{L}\\p{M}])`;
}

/** Arabic-Indic and Persian digits, by value, so "١٢" and "12" are the same number. */
const OTHER_DIGITS = ['٠١٢٣٤٥٦٧٨٩', '۰۱۲۳۴۵۶۷۸۹'];

function asciiDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/gu, (digit) => String(OTHER_DIGITS.find((set) => set.includes(digit))!.indexOf(digit)));
}

/** A trigger's words, lowercase, without punctuation, numbers as digits: how it is compared. */
export function snippetTriggerKey(trigger: string): string {
  // "address12" is said as "address 12", so letters and digits are separate words.
  // Arabic diacritics and tatweel are dropped: the trigger matches with or without them.
  const plain = asciiDigits(trigger.toLowerCase()).replace(/[ً-ْٰـ]/gu, '');
  return foldNumberWords(plain.match(/\p{N}+|[\p{L}\p{M}]+/gu) ?? []).join(' ');
}

/** Saved snippets, keeping valid ones only: a trigger with a letter or digit, used once. */
export function parseSnippets(value: unknown): Snippet[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((raw): Snippet[] => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const trigger = typeof item.trigger === 'string' ? item.trigger.replace(/\s+/gu, ' ').trim().slice(0, MAX_SNIPPET_TRIGGER) : '';
    const expansion = typeof item.expansion === 'string' ? item.expansion.replace(/\r\n?/gu, '\n').slice(0, MAX_SNIPPET_EXPANSION) : '';
    const key = snippetTriggerKey(trigger);
    if (!key || !expansion.trim() || typeof item.id !== 'string' || !item.id || seen.has(key)) return [];
    seen.add(key);
    const createdAt = typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)) ? item.createdAt : new Date(0).toISOString();
    return [{ id: item.id, trigger, expansion, createdAt }];
  });
}

/** Words of a trigger as a pattern, whole words only. */
function triggerPattern(key: string, strict: boolean): string {
  const between = strict ? BETWEEN.strict : BETWEEN.loose;
  const words = key.split(' ');
  const isNumber = (word: string) => /^\d+$/u.test(word);
  return words.map((word, index) => {
    const gap = index ? `${between}+` : '';
    // Arabic words match with any alef form and with taa marbuta written as haa ("غرفه").
    const escaped = arabicLetters(word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
    if (!isNumber(word)) {
      // Letters may follow written digits directly ("12th"), but never number words ("oned").
      return index && isNumber(words[index - 1]) ? `(?:(?<=\\p{N})${between}*|${gap})${escaped}` : gap + escaped;
    }
    // Digits in any script, so "١٢" matches too.
    const digits = [...word].map((digit) => `[${digit}${OTHER_DIGITS.map((set) => set[Number(digit)]).join('')}]`).join('');
    // A number matches as digits or as its words, with or without "and" after hundred or thousand,
    // and a four-digit one also as a year said in pairs.
    const spoken = numberWords(Number(word));
    const said = spoken?.map((part, at) => at && /^(?:hundred|thousand)$/u.test(spoken[at - 1])
      ? `(?:and${between}+)?${part}`
      : part).join(`${between}+`);
    const year = word.length === 4 ? yearWords(Number(word)) : undefined;
    const arabic = word.length <= 2 ? arabicNumberPattern(Number(word), between) : undefined;
    const spelled = [said, year?.join(`${between}+`), arabic].filter(Boolean).join('|');
    // Written digits may follow letters directly ("address12"); number words need a space ("d one", not "done").
    const digitGap = index && !isNumber(words[index - 1]) ? `${between}*` : gap;
    // A number is not the trigger's number when a bigger number word follows it: "two hundred",
    // "خمسة عشر" (15), "تلات مية" (300).
    const notBigger = `(?!${between}+${largerNumberWords()})`;
    return `(?:${digitGap}${digits}${spelled ? `|${gap}(?:${spelled})` : ''})${notBigger}`;
  }).join('');
}

/** A whole-word matcher for any of the given triggers, each in its own group. */
function triggersMatcher(triggers: readonly { key: string; strict: boolean }[]): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}])(?:${triggers.map(({ key, strict }) => `(${triggerPattern(key, strict)})`).join('|')})(?![\\p{L}\\p{M}\\p{N}])([${SENTENCE_MARKS}]*)`,
    'giu',
  );
}

/** Whether the text has the snippet's trigger, strictly (no punctuation inside it) or loosely. */
function hasTrigger(text: string, snippet: Snippet, entries: readonly { word: string; heardAs?: string }[], strict: boolean): boolean {
  const matcher = triggersMatcher(triggerKeys(snippet, entries).map((key) => ({ key, strict })));
  return [text, applyDictionaryReplacements(text, entries)].some((candidate) => candidate.search(matcher) >= 0);
}

/**
 * The snippets whose trigger the speech recognizer wrote, with no punctuation inside it. Decided on
 * the raw transcript, since cleanup may add or remove commas whatever it is told.
 */
export function snippetsSaidIn(
  text: string,
  snippets: readonly Snippet[],
  entries: readonly { word: string; heardAs?: string }[] = [],
): Snippet[] {
  return snippets.filter((snippet) => hasTrigger(text, snippet, entries, true));
}

/**
 * Snippets the recognizer wrote in a form the app cannot read ("عنوان واحد وعشرين") that cleanup
 * wrote plainly ("عنوان 21"). Only when the raw text has no form of the trigger at all: if it has
 * one with punctuation inside ("My address: 12 October"), the speaker did not mean it.
 */
export function snippetsFromCleanup(
  rawText: string,
  cleanedText: string,
  snippets: readonly Snippet[],
  entries: readonly { word: string; heardAs?: string }[] = [],
): Snippet[] {
  return snippets.filter((snippet) => !hasTrigger(rawText, snippet, entries, false)
    && !punctuatedBesideNumber(rawText, snippet.trigger)
    && hasTrigger(cleanedText, snippet, entries, true));
}

/**
 * Whether the raw text has the words of a trigger with punctuation where its number goes: "Mon
 * adresse: vingt et un" for "mon adresse 21". The app cannot read every language's numbers, but
 * it can see the punctuation that says the words were not meant as the trigger.
 */
function punctuatedBesideNumber(rawText: string, trigger: string): boolean {
  const runs = snippetTriggerKey(trigger).split(/\s*\b\d+\b\s*/u);
  if (runs.length < 2) return false;
  const marks = `[${SENTENCE_MARKS}]`;
  return runs.some((run, index) => {
    if (!run.trim()) return false;
    const words = triggerPattern(run.trim(), false);
    const start = '(?<![\\p{L}\\p{M}\\p{N}])';
    const end = '(?![\\p{L}\\p{M}\\p{N}])';
    const before = index < runs.length - 1 ? `${start}${words}\\s*${marks}` : '';
    const after = index > 0 ? `${marks}\\s*${words}${end}` : '';
    return [before, after].filter(Boolean).some((pattern) => new RegExp(pattern, 'iu').test(rawText));
  });
}

/** Both spellings a trigger can arrive in: as saved, and with dictionary replacements applied. */
function triggerKeys(snippet: Snippet, entries: readonly { word: string; heardAs?: string }[]): string[] {
  return [...new Set([snippetTriggerKey(snippet.trigger), snippetTriggerKey(applyDictionaryReplacements(snippet.trigger, entries))])].filter(Boolean);
}

/** The snippet whose trigger is all the text says, if any. Its expansion is then pasted as is. */
export function wholeSnippet(
  text: string,
  snippets: readonly Snippet[],
  entries: readonly { word: string; heardAs?: string }[] = [],
): Snippet | undefined {
  // The recognizer may write a word of the trigger the way the dictionary says it is heard.
  const keys = [snippetTriggerKey(text), snippetTriggerKey(applyDictionaryReplacements(text, entries))].filter(Boolean).map(sameArabicLetters);
  return keys.length ? snippets.find((snippet) => triggerKeys(snippet, entries).some((key) => keys.includes(sameArabicLetters(key)))) : undefined;
}

/**
 * Replaces each trigger phrase in the text with its expansion, longest trigger first, in one pass
 * so an expansion is never matched again. Punctuation cleanup put right after a trigger is dropped
 * when the expansion ends a sentence or spans lines, so a signature gets no stray period. With
 * `loose`, punctuation inside a trigger is allowed, for snippets already found in the raw transcript,
 * but only for a snippet the text has no unpunctuated form of: where cleanup kept the punctuation,
 * it still tells the meant trigger from words that look like one ("My address: 12 October City.
 * Send it to my address 12.").
 */
export function expandSnippets(
  text: string,
  snippets: readonly Snippet[],
  entries: readonly { word: string; heardAs?: string }[] = [],
  { loose = false }: { loose?: boolean } = {},
): { text: string; fired: boolean; startsWithExpansion: boolean } {
  const pairs = snippets
    .flatMap((snippet) => {
      const strict = !loose || hasTrigger(text, snippet, entries, true);
      return triggerKeys(snippet, entries).map((key) => ({ key, strict, expansion: snippet.expansion }));
    })
    .sort((a, b) => b.key.length - a.key.length);
  if (!pairs.length || !text) return { text, fired: false, startsWithExpansion: false };
  const matcher = triggersMatcher(pairs);
  let fired = false;
  let startsWithExpansion = false;
  const result = text.replace(matcher, (...args) => {
    const offset = args.at(-2) as number;
    const groups = args.slice(1, pairs.length + 1) as (string | undefined)[];
    const trailing = (args[pairs.length + 1] as string | undefined) ?? '';
    const { expansion } = pairs[groups.findIndex((group) => typeof group === 'string')];
    fired = true;
    if (!text.slice(0, offset).trim()) startsWithExpansion = true;
    const endsSentence = /[.!?…؟]\s*$/u.test(expansion) || expansion.includes('\n');
    return expansion + (endsSentence ? '' : trailing);
  });
  return { text: result, fired, startsWithExpansion };
}

/**
 * Adds imported words to the dictionary. A word already there gains the spelling it replaces if it
 * has none. A spelling another word already uses, or replaces, is dropped.
 */
export function mergeImportedWords(
  dictionary: readonly DictionaryEntry[],
  words: readonly { word: string; heardAs?: string }[],
  createdAt = new Date().toISOString(),
): { dictionary: DictionaryEntry[]; added: number; updated: number } {
  let entries = [...dictionary];
  const additions: DictionaryEntry[] = [];
  let updated = 0;
  const same = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
  const taken = (heardAs: string, exceptId?: string) => [...entries, ...additions]
    .some((entry) => entry.id !== exceptId && (same(entry.word, heardAs) || same(entry.heardAs, heardAs)));
  words.forEach(({ word, heardAs }, index) => {
    const existing = entries.find((entry) => same(entry.word, word));
    const usable = heardAs && !same(heardAs, word) && !taken(heardAs, existing?.id) ? heardAs : undefined;
    if (existing) {
      if (usable && !existing.heardAs) {
        entries = entries.map((entry) => entry.id === existing.id ? { ...entry, heardAs: usable } : entry);
        updated += 1;
      }
      return;
    }
    if (additions.some((entry) => same(entry.word, word))) return;
    additions.push({ id: `d-${Date.parse(createdAt)}-${index}`, word, source: 'manual', createdAt, ...(usable && { heardAs: usable }) });
  });
  return { dictionary: [...additions, ...entries], added: additions.length, updated };
}

/**
 * Writes each dictionary word where the text has the spelling the user said it is heard as
 * ("hand of" becomes "handoff"). One pass, longest first, so one replacement never feeds another.
 */
export function applyDictionaryReplacements(
  text: string,
  entries: readonly { word: string; heardAs?: string }[],
): string {
  const pairs = entries
    .flatMap((entry) => entry.heardAs && entry.heardAs.toLowerCase() !== entry.word.toLowerCase() ? [{ from: entry.heardAs, to: entry.word }] : [])
    .sort((a, b) => b.from.length - a.from.length);
  if (!pairs.length || !text) return text;
  const pattern = (from: string) => from.split(' ').map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('\\s+');
  const matcher = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${pairs.map(({ from }) => `(${pattern(from)})`).join('|')})(?![\\p{L}\\p{M}\\p{N}])`, 'giu');
  return text.replace(matcher, (match, ...groups) => {
    const to = pairs[groups.findIndex((group) => typeof group === 'string')].to;
    // At the start of a sentence the replacement keeps the capital.
    const capital = match[0] !== match[0].toLocaleLowerCase() && to === to.toLocaleLowerCase();
    return capital ? to[0].toLocaleUpperCase() + to.slice(1) : to;
  });
}

/**
 * Whether a hand edit changed how words are written (casing or punctuation on words the edit
 * kept), not only which words. Fixing a misheard name or adding a sentence is not a style choice.
 */
export function isStyleEdit(before: string, after: string, ignoredWords: readonly string[] = []): boolean {
  // Words the edit respelled as terms ("github" to "GitHub") are dictionary fixes, not style.
  const ignored = new Set(ignoredWords.map((word) => word.toLowerCase()));
  const bareKey = (word: string) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
  const a = before.trim().split(/\s+/u).filter(Boolean).slice(0, 400);
  const b = after.trim().split(/\s+/u).filter(Boolean).slice(0, 400);
  // Longest common subsequence of words, then compare the kept words as written.
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = bareKey(a[i]) && bareKey(a[i]) === bareKey(b[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (bareKey(a[i]) && bareKey(a[i]) === bareKey(b[j])) {
      if (a[i] !== b[j] && !ignored.has(bareKey(b[j]))) return true;
      i++; j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  return false;
}

/**
 * Text at the destination with Yap Yap's own earlier pastes taken out, so the app never learns
 * its own output as the user's writing. Returns nothing when too little of the user's text is left.
 */
export function userWrittenText(textBefore: string | undefined, ownTexts: readonly string[]): string | undefined {
  // Compared line by line and sentence by sentence, ignoring spacing and case: the caret text is
  // a fixed window that can start in the middle of a paste, and pastes may have had their first
  // letter lowercased to continue a sentence.
  const plain = (text: string) => text.replace(/\s+/gu, ' ').trim().toLowerCase();
  const own = ownTexts.map(plain).filter((text) => text.length >= 3);
  const kept = (textBefore ?? '')
    .split(/\r?\n|(?<=[.!?…])\s+/u)
    .map((piece) => piece.trim())
    .filter((piece) => piece && !own.some((text) => text.includes(plain(piece))));
  const text = kept.join('\n');
  return text.replace(/\s+/gu, '').length >= 20 ? text : undefined;
}

/** Whether the word appears whole and capitalized somewhere other than a sentence start, like a name. */
function isWrittenMidSentence(word: string, text: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const match of text.matchAll(new RegExp(`(?<![\\p{L}\\p{M}'’-])${escaped}(?![\\p{L}\\p{M}'’-])`, 'gu'))) {
    const preceding = text.slice(0, match.index).replace(/["'(\[{“‘\s]+$/u, '');
    if (preceding && !/[.!?…。！？\n]$/u.test(preceding)) return true;
  }
  return false;
}

export function categoryForDestination(destination?: { application?: string; domain?: string }): WritingCategory | undefined {
  if (!destination) return;
  const domain = destination.domain?.toLowerCase().replace(/^www\./, '');
  if (domain) return destinationRules.find(([, pattern]) => pattern.test(domain))?.[0];
  const application = destination.application?.toLowerCase() ?? '';
  return application ? destinationRules.find(([, , pattern]) => matchesWhole(pattern, application))?.[0] : undefined;
}

/** Whether the pattern matches whole words, so "word" never matches "1Password". */
function matchesWhole(pattern: RegExp, text: string): boolean {
  return new RegExp(`(?<!\\p{L})(?:${pattern.source})(?!\\p{L})`, 'u').test(text);
}

function readLabel(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ').slice(0, limit).trim() : '';
}

export function writingCategoryKey(category: string): string {
  return category.normalize('NFKC').trim().toLowerCase();
}

/**
 * Learned phrasing goes into every later cleanup prompt, so it must read as a description of
 * casing and punctuation, never as an instruction, a link, or quoted text from a web page.
 */
const NOT_A_STYLE = /https?:|www\.|[`"{}<>]|\b(?:ignore|disregard|override|instructions?|prompt|system|assistant|you must|reply with)\b/iu;

export function styleDescription(text: string): string {
  return text && !NOT_A_STYLE.test(text) ? text : '';
}

export function parseWritingSample(value: unknown): WritingSample | undefined {
  if (!value || typeof value !== 'object') return;
  const sample = value as Record<string, unknown>;
  const key = writingCategoryKey(readLabel(sample.category, 48));
  const category = WRITING_CATEGORIES.find((name) => writingCategoryKey(name) === key);
  // Tones are one fixed list, so "casual" and "Casual" count as one vote. Older free-text tones
  // ("Casual, friendly") keep their leading tone, or read as Neutral.
  const label = readLabel(sample.tone, 72);
  const tone = label && (knownTone(label)
    ?? WRITING_TONES.find((name) => label.toLowerCase().startsWith(name.toLowerCase()))
    ?? 'Neutral');
  // A phrasing that looks like an instruction or carries a link is dropped; the tone still counts.
  const phrasing = styleDescription(readLabel(sample.phrasing, 120));
  const fromUserText = sample.fromUserText === true && !!phrasing;
  if (category && tone) return { category, tone, phrasing, ...(fromUserText && { fromUserText: true }), ...(fromUserText && sample.fromEdit === true && { fromEdit: true }) };
}

type ProfileEntry = Pick<HistoryItem, 'mode' | 'writingSample' | 'writingCorrection' | 'writingCorrectedAt'> & { text?: string };

export interface WritingProfile extends WritingSample {
  count: number;
  corrections: number;
  /** Text the user corrected by hand, newest first. The strongest signal of how they want to write. */
  examples: string[];
}

export const MAX_WRITING_PREFERENCES_LENGTH = 2000;
export const MAX_WRITING_PREFERENCE_RULES = 20;

/** One rule as plain text. Models sometimes add list markers even when asked for plain strings. */
export function cleanWritingRule(line: string): string {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/u, '').replace(/\s+/gu, ' ').trim().slice(0, 240).trim();
}

/**
 * A saved rule applies everywhere, or in one kind of place when it is stored as
 * "[Messaging] Leave out the final period." The app decides where a rule applies, because
 * cleanup models do not reliably skip a rule that is meant for another kind of place.
 */
export function readWritingRule(rule: string): { text: string; category?: WritingCategory } {
  const match = rule.match(/^\[([^\]]+)\]\s*(\S.*)$/u);
  const category = match ? WRITING_CATEGORIES.find((name) => writingCategoryKey(name) === writingCategoryKey(match[1])) : undefined;
  return match && category ? { text: match[2], category } : { text: rule };
}

export function writeWritingRule(text: string, category?: WritingCategory): string {
  return category ? `[${category}] ${text}` : text;
}

/** The rules to follow for a dictation going to the given kind of place. */
export function writingRulesFor(preferences: unknown, category: string | undefined): string[] {
  return parseWritingPreferences(preferences)
    .map(readWritingRule)
    .filter((rule) => !rule.category || rule.category === category)
    .map((rule) => rule.text);
}

/**
 * Saved writing preferences are one rule per line. Accepts stored text or a model's list and
 * returns clean, unique rules within the size limits.
 */
export function parseWritingPreferences(value: unknown): string[] {
  const lines: unknown[] = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : [];
  const seen = new Set<string>();
  const rules: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (typeof line !== 'string') continue;
    const { text, category } = readWritingRule(cleanWritingRule(line));
    const rule = writeWritingRule(text, category);
    // A final period does not make a different rule.
    const key = rule.toLowerCase().replace(/[.\s]+$/u, '');
    if (!rule || seen.has(key)) continue;
    if (rules.length >= MAX_WRITING_PREFERENCE_RULES || length + rule.length + 1 > MAX_WRITING_PREFERENCES_LENGTH) break;
    seen.add(key);
    rules.push(rule);
    length += rule.length + 1;
  }
  return rules;
}

const NEGATIONS = new Set(['no', 'not', 'without', 'never', 'avoid', 'avoids', 'minimal', 'omit', 'omits', 'omitted']);
const CAPITALS = /^(?:capital\p{L}*|uppercase|sentence|standard|proper)$/u;

/** A phrasing's words, plus the ones it says are used and the ones it says are left out. */
function habitWords(phrasing: string) {
  const words = (phrasing.toLowerCase().match(/\p{L}+/gu) ?? [])
    .map((word) => CAPITALS.test(word) ? 'capitals' : word.length > 3 ? word.replace(/s$/u, '') : word);
  const used = new Set<string>();
  const missing = new Set<string>();
  words.forEach((word, index) => {
    if (NEGATIONS.has(word)) return;
    (NEGATIONS.has(words[index - 1]) ? missing : used).add(word);
  });
  // Lowercase text has no capitals.
  if (used.has('lowercase')) missing.add('capitals');
  return { all: new Set(words), used, missing };
}

/** Whether two phrasings describe the same casing and punctuation habit, worded differently. */
export function sameHabit(a: string, b: string): boolean {
  const left = habitWords(a);
  const right = habitWords(b);
  if (!left.all.size || !right.all.size) return false;
  // "no punctuation" and "full punctuation" share words but say opposite things.
  const clash = (one: typeof left, other: typeof left) => [...one.used].some((word) => other.missing.has(word));
  if (clash(left, right) || clash(right, left)) return false;
  const shared = [...left.all].filter((word) => right.all.has(word)).length;
  return shared / (left.all.size + right.all.size - shared) >= 0.5;
}

/** How many plain dictations one hand correction is worth. */
const CORRECTION_WEIGHT = 3;
/** The newest dictations that vote on a category's tone. */
const TONE_WINDOW = 50;
/** The newest samples of the user's own writing that vote on phrasing. */
const PHRASING_WINDOW = 10;

export function buildWritingProfiles(items: readonly ProfileEntry[]): WritingProfile[] {
  const groups = new Map<string, { sample: WritingSample; corrected: boolean; correctedAt: number; text?: string }[]>();
  for (const item of items) {
    if (item.mode !== 'dictate') continue;
    const sample = parseWritingSample(item.writingSample);
    if (!sample) continue;
    const group = groups.get(sample.category) ?? [];
    const correctedAt = (item.writingCorrectedAt && Date.parse(item.writingCorrectedAt)) || 0;
    group.push({ sample, corrected: item.writingCorrection === true, correctedAt, text: item.text });
    groups.set(sample.category, group);
  }

  return [...groups].map(([category, entries]) => {
    // History is newest first. A hand correction counts as three dictations, the same weight as in
    // personalizationScore, so it leads without stopping the category from learning.
    // Newest edit first: editing an old dictation today makes it the newest correction.
    const corrected = entries.filter((entry) => entry.corrected).sort((a, b) => b.correctedAt - a.correctedAt);
    // Tone follows recent habits: only the newest dictations vote, so a change in how the user
    // writes shows up instead of being outvoted by years of old samples.
    const votes = new Map<string, number>();
    for (const { sample, corrected: isCorrection } of entries.slice(0, TONE_WINDOW)) {
      votes.set(sample.tone, (votes.get(sample.tone) ?? 0) + (isCorrection ? CORRECTION_WEIGHT : 1));
    }
    const tone = [...votes].sort((a, b) => b[1] - a[1])[0][0];
    // Casing and punctuation are learned only from text the user wrote: hand edits and text
    // already at the destination. Speech output describes the recognizer, not the user.
    // The newest correction comes first, then the most common recent phrasing (newest on a tie),
    // so one dictation does not swing it. A final period would read as "x.; y" once joined.
    const plain = (entry: { sample: WritingSample }) => entry.sample.phrasing.replace(/[.\s]+$/u, '');
    const ownWriting = entries.filter((entry) => entry.corrected || entry.sample.fromUserText).slice(0, PHRASING_WINDOW);
    // A fix made right after a paste can be a one-off, like a joke in lowercase. Its phrasing
    // counts only once another sample of the user's writing describes the same habit.
    const written = ownWriting.filter((entry) => entry.corrected || !entry.sample.fromEdit
      || ownWriting.some((other) => other !== entry && sameHabit(other.sample.phrasing, entry.sample.phrasing)));
    const tally = new Map<string, { text: string; count: number; newest: number }>();
    written.forEach((entry, index) => {
      const text = plain(entry);
      if (!text) return;
      const key = writingCategoryKey(text);
      const seen = tally.get(key);
      tally.set(key, { text: seen?.text ?? text, count: (seen?.count ?? 0) + (entry.corrected ? CORRECTION_WEIGHT : 1), newest: seen?.newest ?? index });
    });
    const common = [...tally.values()].sort((a, b) => b.count - a.count || a.newest - b.newest).map((item) => item.text);
    const phrasings = [...corrected.slice(0, 1).map(plain), ...common].filter(Boolean);
    const phrasing = [...new Map(phrasings.map((text) => [writingCategoryKey(text), text])).values()]
      .slice(0, 2).join('; ');
    return {
      category,
      tone,
      phrasing,
      count: entries.length,
      corrections: corrected.length,
      examples: corrected.flatMap((entry) => entry.text?.trim() ? [entry.text.trim().slice(0, 240)] : []).slice(0, 2),
    };
  }).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

/** Room for a corrected version of two joined learned phrasings. */
export const MAX_CORRECTED_PHRASING_LENGTH = 240;

/** Saved corrections, keeping only known categories with a usable tone and phrasing. */
export function parseStyleCorrections(value: unknown): StyleCorrections {
  const corrections: StyleCorrections = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return corrections;
  for (const [key, entry] of Object.entries(value)) {
    const category = WRITING_CATEGORIES.find((name) => writingCategoryKey(name) === writingCategoryKey(key));
    if (!category || !entry || typeof entry !== 'object') continue;
    const fields = entry as Record<string, unknown>;
    // Only known tones, as everywhere else a tone is chosen.
    const tone = knownTone(fields.tone);
    const phrasing = styleDescription(readLabel(fields.phrasing, MAX_CORRECTED_PHRASING_LENGTH));
    if (!tone && !phrasing) continue;
    const since = typeof fields.since === 'string' && !Number.isNaN(Date.parse(fields.since)) ? fields.since : undefined;
    const rejectedFields = (fields.rejected && typeof fields.rejected === 'object' ? fields.rejected : {}) as Record<string, unknown>;
    const readList = (list: unknown, limit: number) => (Array.isArray(list) ? list : [])
      .map((item) => readLabel(item, limit)).filter(Boolean).slice(-MAX_REJECTED_STYLES);
    const tones = readList(rejectedFields.tones, 72).flatMap((value) => knownTone(value) ?? []);
    const phrasings = readList(rejectedFields.phrasings, MAX_CORRECTED_PHRASING_LENGTH);
    corrections[category] = {
      ...(tone && { tone }),
      ...(phrasing && { phrasing }),
      ...(since && { since }),
      ...((tones.length || phrasings.length) && { rejected: { ...(tones.length && { tones }), ...(phrasings.length && { phrasings }) } }),
    };
  }
  return corrections;
}

/** The tone in its usual spelling, if it is one of the known tones. */
function knownTone(value: unknown): string | undefined {
  const label = readLabel(value, 72).toLowerCase();
  return WRITING_TONES.find((tone) => tone.toLowerCase() === label);
}

/** How many turned-down styles each correction remembers. */
const MAX_REJECTED_STYLES = 5;

/** Adds styles the user turned down to a correction, so they are not suggested again. */
export function rejectStyles(
  correction: StyleCorrections[string] | undefined,
  rejected: { tone?: string; phrasing?: string },
): StyleCorrections[string] {
  const add = (list: string[] | undefined, value: string | undefined) => {
    if (!value) return list;
    const rest = (list ?? []).filter((item) => item.toLowerCase() !== value.toLowerCase());
    return [...rest, value].slice(-MAX_REJECTED_STYLES);
  };
  const tones = add(correction?.rejected?.tones, rejected.tone);
  const phrasings = add(correction?.rejected?.phrasings, rejected.phrasing);
  return { ...correction, rejected: { ...(tones && { tones }), ...(phrasings && { phrasings }) } };
}

/**
 * Adds corrections to saved ones field by field, so an earlier tone fix survives a later
 * punctuation fix. `since` marks when the user last decided, for update suggestions.
 */
export function mergeStyleCorrections(saved: StyleCorrections, changes: StyleCorrections, since?: string): StyleCorrections {
  const merged = { ...saved };
  for (const [category, correction] of Object.entries(changes)) {
    merged[category] = { ...merged[category], ...correction, ...(since && { since }) };
  }
  return merged;
}

/** Styles a user can pick for a kind of place before Yap Yap has learned anything there. */
export const STYLE_PRESETS = [
  { id: 'formal', label: 'Formal', example: 'Hey Sam. See you soon.', tone: 'Formal', phrasing: 'Capitalized sentences and names, every sentence ends with punctuation' },
  { id: 'casual', label: 'Casual', example: 'Hey Sam, see you soon', tone: 'Casual', phrasing: 'Capitalized sentences and names, no period after the last sentence' },
  { id: 'very-casual', label: 'Very casual', example: 'hey sam see you soon', tone: 'Casual', phrasing: 'all lowercase, even names and I, no period after the last sentence' },
] as const;

export type StylePresetId = (typeof STYLE_PRESETS)[number]['id'];

/** The preset a saved style is, or undefined for a style the user wrote. */
export function presetOf(correction: StyleCorrections[string] | undefined): StylePresetId | undefined {
  return STYLE_PRESETS.find((preset) => correction?.tone === preset.tone && correction?.phrasing === preset.phrasing)?.id;
}

/**
 * Styles cleanup uses: learned styles with enough dictations, and every style the user set, even
 * for a kind of place with no dictations yet. A style the user set always wins over what is learned.
 */
export function stylesForCleanup<T extends WritingProfile & { corrected?: boolean }>(
  profiles: readonly T[],
  corrections: StyleCorrections,
  options: {
    /** The kind of place the dictation goes to, when known. Only its style is used. */
    category?: string;
    /** The style for places with nothing picked or learned, and for places Yap Yap can't tell. */
    defaultStyle?: string;
  } = {},
): (T | WritingProfile & { corrected: true })[] {
  const set = Object.entries(corrections).flatMap(([category, correction]) =>
    !profiles.some((profile) => profile.category === category) && (correction.tone || correction.phrasing)
      ? [{ category, tone: correction.tone ?? 'Neutral', phrasing: correction.phrasing ?? '', count: 0, corrections: 0, examples: [], corrected: true as const }]
      : []);
  const all = [...readyStyles(profiles), ...set];
  const styles = options.category ? all.filter((style) => style.category === options.category) : all;
  const preset = STYLE_PRESETS.find((item) => item.id === options.defaultStyle);
  if (!preset || (options.category && styles.length)) return styles;
  // A known place with no style takes the default. An unknown place gets it as the fallback entry.
  return [...styles, {
    category: options.category ?? EVERYWHERE_ELSE, tone: preset.tone, phrasing: preset.phrasing,
    count: 0, corrections: 0, examples: [], corrected: true as const,
  }];
}

/** The context name cleanup sees for the default style. */
export const EVERYWHERE_ELSE = 'Everywhere else';

/** Dictations a corrected category needs after the correction before an update is suggested. */
export const STYLE_UPDATE_MIN_SAMPLES = 5;

/** A style learned after a correction, and whether it came from a hand edit. */
export type StyleSampleSinceCorrection = WritingSample & { corrected?: boolean };

/**
 * For each corrected category, the styles learned from dictations made or hand-edited after the
 * correction, newest first. Only categories with enough of them to judge are included.
 */
export function samplesSinceCorrection(
  history: readonly Pick<HistoryItem, 'mode' | 'createdAt' | 'writingSample' | 'writingCorrection' | 'writingCorrectedAt'>[],
  corrections: StyleCorrections,
): Record<string, StyleSampleSinceCorrection[]> {
  const result: Record<string, StyleSampleSinceCorrection[]> = {};
  for (const [category, correction] of Object.entries(corrections)) {
    const since = correction.since ? Date.parse(correction.since) : NaN;
    if (Number.isNaN(since)) continue;
    const samples = history.flatMap((item) => {
      const sample = item.mode === 'dictate' ? parseWritingSample(item.writingSample) : undefined;
      if (sample?.category !== category) return [];
      // A hand edit made now to an older dictation is recent writing too.
      const time = (value: string | undefined) => (value && Date.parse(value)) || 0;
      const at = Math.max(time(item.createdAt), time(item.writingCorrectedAt));
      return at > since ? [{ ...sample, ...(item.writingCorrection && { corrected: true }) }] : [];
    });
    if (samples.length >= STYLE_UPDATE_MIN_SAMPLES) result[category] = samples;
  }
  return result;
}

/**
 * The learned profiles with the user's corrections in place. A correction replaces only the
 * parts it covers, tone or phrasing; the other part keeps following what Yap Yap learns.
 */
export function applyStyleCorrections<T extends WritingProfile>(
  profiles: readonly T[],
  corrections: StyleCorrections | undefined,
): (T & { corrected?: boolean })[] {
  return profiles.map((profile) => {
    const correction = corrections?.[profile.category];
    if (!correction?.tone && !correction?.phrasing) return profile;
    return {
      ...profile,
      ...(correction.tone && { tone: correction.tone }),
      // Cleanup copies the casing and punctuation of hand-edited examples, which were written
      // the way the user just corrected away, so they go with the old phrasing.
      ...(correction.phrasing && { phrasing: correction.phrasing, examples: [] }),
      corrected: true,
    };
  });
}

/** Dictations a category needs before its learned style shapes cleanup. */
export const MIN_STYLE_SAMPLES = 3;

/**
 * Learned styles sure enough to apply: at least MIN_STYLE_SAMPLES dictations, a hand correction,
 * or a style the user set. One odd dictation in a new category then changes nothing.
 */
export function readyStyles<T extends WritingProfile & { corrected?: boolean }>(profiles: readonly T[]): T[] {
  return profiles.filter((profile) => profile.corrected || profile.corrections > 0 || profile.count >= MIN_STYLE_SAMPLES);
}

/** What forgetting removed, so it can be put back. */
export interface ForgottenStyles {
  samples: Record<string, Pick<HistoryItem, 'writingSample' | 'writingCorrection' | 'writingCorrectedAt'>>;
  styleCorrections: StyleCorrections;
  /** Retained samples of deleted History items that were forgotten too. */
  retained?: RetainedStyleSample[];
}

/** Retained samples kept per category: enough for the tone window. */
const RETAINED_PER_CATEGORY = 50;

/** Saved retained samples, keeping valid ones only, newest first and capped per category. */
export function parseRetainedStyles(value: unknown): RetainedStyleSample[] {
  if (!Array.isArray(value)) return [];
  const valid = value.flatMap((raw): RetainedStyleSample[] => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const writingSample = parseWritingSample(item.writingSample);
    const createdAt = typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)) ? item.createdAt : undefined;
    if (!writingSample || !createdAt || typeof item.id !== 'string' || !item.id) return [];
    const correctedAt = typeof item.writingCorrectedAt === 'string' && Number.isFinite(Date.parse(item.writingCorrectedAt)) ? item.writingCorrectedAt : undefined;
    return [{
      id: item.id.slice(0, 200),
      createdAt,
      writingSample,
      ...(item.writingCorrection === true && { writingCorrection: true, ...(correctedAt && { writingCorrectedAt: correctedAt }) }),
    }];
  });
  return capRetained(valid);
}

function capRetained(samples: readonly RetainedStyleSample[]): RetainedStyleSample[] {
  const seen = new Set<string>();
  const perCategory = new Map<string, number>();
  return [...samples]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .filter((sample) => {
      const count = perCategory.get(sample.writingSample.category) ?? 0;
      if (seen.has(sample.id) || count >= RETAINED_PER_CATEGORY) return false;
      seen.add(sample.id);
      perCategory.set(sample.writingSample.category, count + 1);
      return true;
    });
}

/** The style part of a History item, without its text, audio, or the app or site it went to. */
export function toRetainedStyle(item: Pick<HistoryItem, 'id' | 'createdAt' | 'writingSample' | 'writingCorrection' | 'writingCorrectedAt'>): RetainedStyleSample | undefined {
  return parseRetainedStyles([item])[0];
}

/**
 * Keeps the learned style of dictations that left History (deleted, cleared, or expired), so
 * History settings never erase what Yap Yap learned. Returns the same list when nothing left.
 */
export function retainRemovedStyles(
  before: readonly HistoryItem[],
  after: readonly HistoryItem[],
  retained: readonly RetainedStyleSample[],
): RetainedStyleSample[] {
  const remaining = new Set(after.map((item) => item.id));
  const removed = before.flatMap((item) => {
    if (remaining.has(item.id) || item.mode !== 'dictate' || item.outcome) return [];
    return toRetainedStyle(item) ?? [];
  });
  return removed.length ? capRetained([...removed, ...retained]) : retained as RetainedStyleSample[];
}

/**
 * What learning reads: History plus retained samples of items no longer in it, newest first.
 * Retained samples carry no text, so they never become hand-edited examples.
 */
export function withRetainedStyles<T extends Pick<HistoryItem, 'id' | 'createdAt'>>(
  history: readonly T[],
  retained: readonly RetainedStyleSample[],
): (T | (RetainedStyleSample & { mode: 'dictate' }))[] {
  if (!retained.length) return history as T[];
  const present = new Set(history.map((item) => item.id));
  const extra = retained.filter((sample) => !present.has(sample.id) && !!present.add(sample.id))
    .map((sample) => ({ ...sample, mode: 'dictate' as const }));
  return [...history, ...extra].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** Forgets retained samples for the given categories, or all, and returns them for Undo. */
export function forgetRetainedStyles(
  retained: readonly RetainedStyleSample[],
  categories?: readonly string[],
): { retained: RetainedStyleSample[]; forgotten: RetainedStyleSample[] } {
  const matches = (sample: RetainedStyleSample) => !categories || categories.includes(sample.writingSample.category);
  return { retained: retained.filter((sample) => !matches(sample)), forgotten: retained.filter(matches) };
}

/** Puts forgotten retained samples back. */
export function restoreRetainedStyles(
  retained: readonly RetainedStyleSample[],
  forgotten: readonly RetainedStyleSample[] | undefined,
): RetainedStyleSample[] {
  return forgotten?.length ? capRetained([...retained, ...forgotten]) : retained as RetainedStyleSample[];
}

/**
 * Forgets the learned style for the given categories, or for all of them. The dictated text
 * stays in History; only the style samples and the user's corrections for those categories go.
 */
export function forgetWritingStyles<T extends Pick<HistoryItem, 'id' | 'writingSample' | 'writingCorrection' | 'writingCorrectedAt'>>(
  history: readonly T[],
  corrections: StyleCorrections,
  categories?: readonly string[],
): { history: T[]; styleCorrections: StyleCorrections; forgotten: ForgottenStyles } {
  const matches = (category: string | undefined) => !!category && (!categories || categories.includes(category));
  const forgotten: ForgottenStyles = { samples: {}, styleCorrections: {} };
  const nextHistory = history.map((item) => {
    if (!matches(item.writingSample?.category)) return item;
    forgotten.samples[item.id] = { writingSample: item.writingSample, writingCorrection: item.writingCorrection, writingCorrectedAt: item.writingCorrectedAt };
    const { writingSample: _sample, writingCorrection: _correction, writingCorrectedAt: _correctedAt, ...rest } = item;
    return rest as T;
  });
  const styleCorrections: StyleCorrections = {};
  for (const [category, correction] of Object.entries(corrections)) {
    if (matches(category)) forgotten.styleCorrections[category] = correction;
    else styleCorrections[category] = correction;
  }
  return { history: nextHistory, styleCorrections, forgotten };
}

/** Puts forgotten styles back. Items deleted since then stay deleted. */
export function restoreWritingStyles<T extends Pick<HistoryItem, 'id' | 'writingSample' | 'writingCorrection' | 'writingCorrectedAt'>>(
  history: readonly T[],
  corrections: StyleCorrections,
  forgotten: ForgottenStyles,
): { history: T[]; styleCorrections: StyleCorrections } {
  return {
    // A style learned again since then is newer, so it wins.
    history: history.map((item) => forgotten.samples[item.id] && !item.writingSample ? { ...item, ...forgotten.samples[item.id] } : item),
    styleCorrections: { ...forgotten.styleCorrections, ...corrections },
  };
}

/** 0–100 with diminishing returns. A hand correction counts as three plain dictations. */
export function personalizationScore(profile: Pick<WritingProfile, 'count' | 'corrections'>): number {
  const points = profile.count + (CORRECTION_WEIGHT - 1) * profile.corrections;
  return Number((100 * points / (points + 30)).toFixed(1));
}
