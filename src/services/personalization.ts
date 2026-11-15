import type { HistoryItem, StyleCorrections, WritingSample } from '../types/app';

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
  ['Messaging', /(^|\.)(whatsapp\.com|telegram\.org|discord\.com|slack\.com|messenger\.com)$|^teams\.(microsoft|live)\.com$|^(messages|chat)\.google\.com$/, /slack|discord|whatsapp|telegram|teams|signal|messages|messenger/],
  ['Social platforms', /(^|\.)(x\.com|twitter\.com|linkedin\.com|facebook\.com|instagram\.com|reddit\.com|threads\.(net|com)|bsky\.app|tiktok\.com|youtube\.com|mastodon\.social)$/, /^$/],
  ['Project management', /(^|\.)(linear\.app|atlassian\.net|trello\.com|asana\.com|clickup\.com|monday\.com|basecamp\.com)$/, /linear|jira|trello|asana|clickup/],
  ['Development tools', /(^|\.)(github\.com|gitlab\.com|bitbucket\.org|stackoverflow\.com|vercel\.com|codesandbox\.io|replit\.com)$/, /visual studio|cursor|terminal|powershell|intellij|pycharm|webstorm|rider|android studio|xcode|sublime|neovim|zed|windsurf|iterm|warp/],
  ['Document editors', /^docs\.google\.com$|(^|\.)(notion\.so|notion\.site|coda\.io|word\.cloud\.microsoft|dropbox\.com)$/, /word|notion|obsidian|notepad|pages|onenote|textedit|writer/],
];

export interface WritingDestination {
  application: string;
  domain?: string;
}

/** Stable name for where a dictation went: the site in a browser, otherwise the app. */
export function destinationKey(destination?: Partial<WritingDestination>): string | undefined {
  return (destination?.domain ?? destination?.application)?.trim().toLowerCase().replace(/^www\./, '').slice(0, 100) || undefined;
}

/** Categories the model already chose for destinations the built-in rules do not know. */
export function buildSourceCategories(items: readonly Pick<HistoryItem, 'writingSample' | 'writingSource'>[]): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();
  for (const item of items) {
    const category = parseWritingSample(item.writingSample)?.category;
    if (!category || !item.writingSource) continue;
    const tally = votes.get(item.writingSource) ?? new Map<string, number>();
    tally.set(category, (tally.get(category) ?? 0) + 1);
    votes.set(item.writingSource, tally);
  }
  return new Map([...votes].map(([source, tally]) => [source, [...tally].sort((a, b) => b[1] - a[1])[0][0]]));
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
export function isStyleEdit(before: string, after: string): boolean {
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
      if (a[i] !== b[j]) return true;
      i++; j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  return false;
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
  if (category && tone && phrasing) return { category, tone, phrasing };
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
    const votes = new Map<string, number>();
    for (const { sample, corrected: isCorrection } of entries) {
      votes.set(sample.tone, (votes.get(sample.tone) ?? 0) + (isCorrection ? CORRECTION_WEIGHT : 1));
    }
    const tone = [...votes].sort((a, b) => b[1] - a[1])[0][0];
    // The newest correction's phrasing comes first, then the newest learned ones.
    // A final period would read as "x.; y" once two phrasings are joined.
    const phrasings = [...corrected.slice(0, 1), ...entries]
      .map(({ sample }) => sample.phrasing.replace(/[.\s]+$/u, '')).filter(Boolean);
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
