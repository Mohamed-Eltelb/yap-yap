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
    || before!.includes(first)
    || properNouns.some((noun) => noun.split(/\s+/)[0] === first);
  return lead + (keepCapital ? text : text[0].toLocaleLowerCase() + text.slice(1));
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
  const tone = readLabel(sample.tone, 72);
  const phrasing = readLabel(sample.phrasing, 120);
  if (category && tone && phrasing) return { category, tone, phrasing };
}

type ProfileEntry = Pick<HistoryItem, 'mode' | 'writingSample' | 'writingCorrection'> & { text?: string };

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
    const key = rule.toLowerCase();
    if (!rule || seen.has(key)) continue;
    if (rules.length >= MAX_WRITING_PREFERENCE_RULES || length + rule.length + 1 > MAX_WRITING_PREFERENCES_LENGTH) break;
    seen.add(key);
    rules.push(rule);
    length += rule.length + 1;
  }
  return rules;
}

export function buildWritingProfiles(items: readonly ProfileEntry[]): WritingProfile[] {
  const groups = new Map<string, { sample: WritingSample; corrected: boolean; text?: string }[]>();
  for (const item of items) {
    if (item.mode !== 'dictate') continue;
    const sample = parseWritingSample(item.writingSample);
    if (!sample) continue;
    const group = groups.get(sample.category) ?? [];
    group.push({ sample, corrected: item.writingCorrection === true, text: item.text });
    groups.set(sample.category, group);
  }

  return [...groups].map(([category, entries]) => {
    // History is newest first. Hand corrections outrank samples taken from raw speech.
    const corrected = entries.filter((entry) => entry.corrected);
    const pool = corrected.length ? corrected : entries;
    const votes = new Map<string, number>();
    for (const { sample } of pool) votes.set(sample.tone, (votes.get(sample.tone) ?? 0) + 1);
    const tone = [...votes].sort((a, b) => b[1] - a[1])[0][0];
    // A final period would read as "x.; y" once two phrasings are joined.
    const phrasings = pool.map(({ sample }) => sample.phrasing.replace(/[.\s]+$/u, '')).filter(Boolean);
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

/** Saved corrections, keeping only known categories with a usable tone and phrasing. */
export function parseStyleCorrections(value: unknown): StyleCorrections {
  const corrections: StyleCorrections = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return corrections;
  for (const [category, entry] of Object.entries(value)) {
    const sample = parseWritingSample(entry && typeof entry === 'object' ? { ...entry, category } : undefined);
    if (sample) corrections[sample.category] = { tone: sample.tone, phrasing: sample.phrasing };
  }
  return corrections;
}

/**
 * The learned profiles with the user's corrections in place. A correction replaces the learned
 * tone and phrasing for its category until the user resets it, however much is learned later.
 */
export function applyStyleCorrections<T extends WritingProfile>(
  profiles: readonly T[],
  corrections: StyleCorrections | undefined,
): (T & { corrected?: boolean })[] {
  return profiles.map((profile) => {
    const correction = corrections?.[profile.category];
    return correction ? { ...profile, ...correction, corrected: true } : profile;
  });
}

/** 0–100 with diminishing returns. A hand correction counts as three plain dictations. */
export function personalizationScore(profile: Pick<WritingProfile, 'count' | 'corrections'>): number {
  const points = profile.count + 2 * profile.corrections;
  return Number((100 * points / (points + 30)).toFixed(1));
}
