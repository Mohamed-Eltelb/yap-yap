import type { HistoryItem, RetainedStyleSample, StyleCorrections, WritingSample } from '../types/app';

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
  ['Development tools', /(^|\.)(github\.com|gitlab\.com|bitbucket\.org|stackoverflow\.com|vercel\.com|codesandbox\.io|replit\.com)$/, /visual studio|cursor|terminal|powershell|intellij|pycharm|webstorm|rider|android studio|xcode|sublime|neovim|zed|windsurf|iterm|warp|antigravity|codex/],
  ['Document editors', /^docs\.google\.com$|(^|\.)(notion\.so|notion\.site|coda\.io|word\.cloud\.microsoft|dropbox\.com)$/, /word|notion|obsidian|notepad|pages|onenote|textedit|writer|sticky ?notes/],
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

/** The category the built-in rules give an app or site key, if any. */
export function builtInCategory(key: string): WritingCategory | undefined {
  const looksLikeDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(key);
  return looksLikeDomain ? categoryForDestination({ domain: key }) : categoryForDestination({ application: key });
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
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(key)) return key;
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
  return application ? destinationRules.find(([, , pattern]) => pattern.test(application))?.[0] : undefined;
}

function readLabel(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ').slice(0, limit).trim() : '';
}

export function writingCategoryKey(category: string): string {
  return category.normalize('NFKC').trim().toLowerCase();
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
  const phrasing = readLabel(sample.phrasing, 120);
  if (category && tone && phrasing) return { category, tone, phrasing, ...(sample.fromUserText === true && { fromUserText: true }) };
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
    const written = entries.filter((entry) => entry.corrected || entry.sample.fromUserText).slice(0, PHRASING_WINDOW);
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
    const phrasing = readLabel(fields.phrasing, MAX_CORRECTED_PHRASING_LENGTH);
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
