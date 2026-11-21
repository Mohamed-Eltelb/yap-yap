import type { OtherAppData, OtherAppId, ImportedStyle } from '../../electron/otherApps';
import type { DictionaryEntry, HistoryItem, ProviderId, SettingsState, Snippet } from '../types/app';
import { assignHistoryIds, parseHistoryImport, skipDuplicateHistory } from './historyImport';
import { learnableSource, mergeImportedWords, mergeStyleCorrections, parseSnippets, presetOf, snippetTriggerKey, STYLE_PRESETS } from './personalization';
import { filterByRetention } from './stats';

/** What an import changes, worked out against what Yap Yap already has, before anything is saved. */
export interface ImportPlan {
  app: OtherAppId;
  name: string;
  words: { key: string; word: string; heardAs?: string; manual: boolean; status: 'new' | 'adds-heard-as' | 'exists' }[];
  snippets: { key: string; trigger: string; expansion: string; status: 'new' | 'exists' | 'invalid' }[];
  /** Entries not in History yet, newest first. */
  history: HistoryItem[];
  historyDuplicates: number;
  styles: { category: 'Messaging' | 'Email' | 'default'; style: ImportedStyle; status: 'new' | 'same' | 'different' }[];
  cleanup?: { level: 'none' | 'light' | 'medium'; same: boolean };
  /** The other app learned no words from edits, so Yap Yap shouldn't either. */
  stopLearningFromEdits: boolean;
  notes: string[];
}

export interface ImportSelection {
  words: string[];
  snippets: string[];
  history: boolean;
  styles: string[];
  cleanup: boolean;
  stopLearningFromEdits: boolean;
}

/** What one import added and changed, so Undo can put things back. */
export interface ImportReceipt {
  dictionary: DictionaryEntry[];
  snippets: Snippet[];
  historyIds: string[];
  settings: Partial<SettingsState>;
}

export interface ImportState {
  dictionary: DictionaryEntry[];
  snippets: Snippet[];
  history: HistoryItem[];
  settings: SettingsState;
}

const lower = (value: string) => value.trim().toLowerCase();

function styleId(style: ImportedStyle) {
  return STYLE_PRESETS.find((preset) => preset.id === style)!;
}

/** A language code such as "ar-EG" as a name, for a translation's target. */
function languageName(code: string | undefined): string | undefined {
  if (!code) return;
  try {
    return new Intl.DisplayNames(['en'], { type: 'language', languageDisplay: 'standard' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function historyFrom(data: OtherAppData, defaultProvider: ProviderId): HistoryItem[] {
  const items = data.history.map((item, index) => ({
    id: `${data.app}-${Date.parse(item.createdAt)}-${index}`,
    createdAt: item.createdAt,
    mode: item.mode,
    text: item.text,
    rawText: item.rawText,
    answer: item.answer,
    targetLanguage: item.mode === 'translate' ? languageName(item.targetLanguage) : undefined,
    durationMs: item.durationMs,
    model: data.name,
    // The app it went to counts toward Apps and sites, like a dictation made here.
    writingSource: item.mode === 'dictate' ? learnableSource(item.application) : undefined,
  }));
  return parseHistoryImport(JSON.stringify(items), defaultProvider);
}

export function planImport(data: OtherAppData, state: ImportState, defaultProvider: ProviderId): ImportPlan {
  const seenWords = new Set<string>();
  const words = data.words.flatMap((item): ImportPlan['words'] => {
    const key = lower(item.word);
    if (!key || seenWords.has(key)) return [];
    seenWords.add(key);
    const existing = state.dictionary.find((entry) => lower(entry.word) === key);
    const status = !existing ? 'new' : item.heardAs && !existing.heardAs ? 'adds-heard-as' : 'exists';
    return [{ key, word: item.word.trim(), heardAs: item.heardAs, manual: item.manual, status }];
  });

  const taken = new Set(state.snippets.map((snippet) => snippetTriggerKey(snippet.trigger)));
  const snippets = data.snippets.map((item, index): ImportPlan['snippets'][number] => {
    // Checked the way saved snippets are, so what the review shows is what gets saved.
    const valid = parseSnippets([{ id: `check-${index}`, trigger: item.trigger, expansion: item.expansion }])[0];
    const key = valid ? snippetTriggerKey(valid.trigger) : `invalid-${index}`;
    const status = !valid ? 'invalid' : taken.has(key) ? 'exists' : 'new';
    if (valid) taken.add(key);
    return { key, trigger: valid?.trigger ?? item.trigger, expansion: valid?.expansion ?? item.expansion, status };
  });

  const imported = historyFrom(data, defaultProvider);
  const history = skipDuplicateHistory(imported, state.history)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const styles = Object.entries(data.settings.styles ?? {}).map(([category, style]) => {
    const current = category === 'default' ? state.settings.defaultStyle || undefined : presetOf(state.settings.styleCorrections[category]);
    const picked = category === 'default' ? Boolean(state.settings.defaultStyle) : Boolean(state.settings.styleCorrections[category]);
    const status = current === style ? 'same' : picked ? 'different' : 'new';
    return { category: category as ImportPlan['styles'][number]['category'], style: style!, status } as const;
  });

  const level = data.settings.cleanup;
  const currentLevel = state.settings.smartCleanup ? state.settings.cleanupLevel : 'none';

  return {
    app: data.app,
    name: data.name,
    words,
    snippets,
    history,
    historyDuplicates: imported.length - history.length,
    styles,
    cleanup: level ? { level, same: level === currentLevel } : undefined,
    stopLearningFromEdits: data.settings.learnWords === false && state.settings.learnFromEdits,
    notes: data.notes,
  };
}

/** What the review selects at first: everything new, and no change to something the user set. */
export function defaultSelection(plan: ImportPlan): ImportSelection {
  return {
    words: plan.words.filter((item) => item.status !== 'exists').map((item) => item.key),
    snippets: plan.snippets.filter((item) => item.status === 'new').map((item) => item.key),
    history: plan.history.length > 0,
    styles: plan.styles.filter((item) => item.status === 'new').map((item) => item.category),
    cleanup: Boolean(plan.cleanup && !plan.cleanup.same),
    stopLearningFromEdits: plan.stopLearningFromEdits,
  };
}

export function applyImport<T extends ImportState>(
  state: T,
  plan: ImportPlan,
  selection: ImportSelection,
  now = new Date().toISOString(),
): { state: T; receipt: ImportReceipt; added: { words: number; heardAs: number; snippets: number; history: number; settings: number } } {
  const receipt: ImportReceipt = { dictionary: state.dictionary, snippets: state.snippets, historyIds: [], settings: {} };

  const chosenWords = plan.words.filter((item) => item.status !== 'exists' && selection.words.includes(item.key));
  const merged = mergeImportedWords(state.dictionary, chosenWords, now);
  // Words the other app learned on its own stay marked as learned.
  const learned = new Set(chosenWords.filter((item) => !item.manual).map((item) => item.key));
  const had = new Set(state.dictionary.map((entry) => entry.id));
  const dictionary = merged.dictionary.map((entry) =>
    !had.has(entry.id) && learned.has(lower(entry.word)) ? { ...entry, source: 'auto' as const } : entry);

  const newSnippets = plan.snippets
    .filter((item) => item.status === 'new' && selection.snippets.includes(item.key))
    .map((item, index) => ({ id: `s-${plan.app}-${Date.parse(now)}-${index}`, trigger: item.trigger, expansion: item.expansion, createdAt: now }));
  const snippets = parseSnippets([...newSnippets, ...state.snippets]);

  let history = state.history;
  let addedHistory = 0;
  if (selection.history && plan.history.length) {
    const fresh = assignHistoryIds(skipDuplicateHistory(plan.history, state.history), state.history.map((item) => item.id));
    const kept = filterByRetention(
      [...fresh, ...state.history].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
      state.settings.historyRetention,
    );
    const freshIds = new Set(fresh.map((item) => item.id));
    receipt.historyIds = kept.filter((item) => freshIds.has(item.id)).map((item) => item.id);
    addedHistory = receipt.historyIds.length;
    history = kept;
  }

  const settings = { ...state.settings };
  const remember = <K extends keyof SettingsState>(key: K) => {
    if (!(key in receipt.settings)) receipt.settings[key] = state.settings[key];
  };
  let changedSettings = 0;
  for (const item of plan.styles) {
    if (!selection.styles.includes(item.category) || item.status === 'same') continue;
    const preset = styleId(item.style);
    if (item.category === 'default') {
      remember('defaultStyle');
      settings.defaultStyle = preset.id;
    } else {
      remember('styleCorrections');
      settings.styleCorrections = mergeStyleCorrections(settings.styleCorrections, { [item.category]: { tone: preset.tone, phrasing: preset.phrasing } }, now);
    }
    changedSettings += 1;
  }
  if (selection.cleanup && plan.cleanup && !plan.cleanup.same) {
    remember('smartCleanup');
    remember('cleanupLevel');
    settings.smartCleanup = plan.cleanup.level !== 'none';
    if (plan.cleanup.level !== 'none') settings.cleanupLevel = plan.cleanup.level;
    changedSettings += 1;
  }
  if (selection.stopLearningFromEdits && plan.stopLearningFromEdits) {
    remember('learnFromEdits');
    settings.learnFromEdits = false;
    changedSettings += 1;
  }

  return {
    state: { ...state, dictionary, snippets, history, settings },
    receipt,
    added: { words: merged.added, heardAs: merged.updated, snippets: newSnippets.length, history: addedHistory, settings: changedSettings },
  };
}

/** Puts back what an import changed. Dictionary words and snippets added since then are kept. */
export function undoImport<T extends ImportState>(state: T, receipt: ImportReceipt, after: { dictionary: DictionaryEntry[]; snippets: Snippet[] }): T {
  const hadWords = new Set(receipt.dictionary.map((entry) => entry.id));
  const hadSnippets = new Set(receipt.snippets.map((entry) => entry.id));
  const addedWords = new Set(after.dictionary.filter((entry) => !hadWords.has(entry.id)).map((entry) => entry.id));
  const addedSnippets = new Set(after.snippets.filter((entry) => !hadSnippets.has(entry.id)).map((entry) => entry.id));
  const importIds = new Set(receipt.historyIds);
  const before = new Map(receipt.dictionary.map((entry) => [entry.id, entry]));
  return {
    ...state,
    // A word the import only gave a heard-as spelling goes back to how it was.
    dictionary: state.dictionary.filter((entry) => !addedWords.has(entry.id)).map((entry) => before.get(entry.id) ?? entry),
    snippets: state.snippets.filter((entry) => !addedSnippets.has(entry.id)),
    history: state.history.filter((item) => !importIds.has(item.id)),
    settings: { ...state.settings, ...receipt.settings },
  };
}
