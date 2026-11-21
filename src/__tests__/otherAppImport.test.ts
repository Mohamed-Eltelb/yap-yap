import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { readDate, readOtherApps, type OtherAppData } from '../../electron/otherApps';
import { applyImport, defaultSelection, planImport, undoImport, type ImportState } from '../services/otherAppImport';
import { getInitialState } from '../services/storage';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function appData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yy-other-apps-'));
  dirs.push(dir);
  return dir;
}

function database(file: string, sql: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(sql);
  db.close();
}

describe('Reading other dictation apps', () => {
  it('reads Wispr Flow words, corrections, snippets, history, and settings', () => {
    const root = appData();
    database(path.join(root, 'Wispr Flow', 'flow.sqlite'), `
      create table Dictionary (id text, phrase text, replacement text, isSnippet int, manualEntry int, isDeleted int);
      insert into Dictionary values
        ('1', 'Supabase', null, 0, 1, 0),
        ('2', 'hand of', 'handoff', 0, 0, 0),
        ('3', 'my sig', 'Best,\nSam', 1, 1, 0),
        ('4', 'gone', null, 0, 1, 1);
      create table History (transcriptEntityId text, asrText text, formattedText text, editedText text, timestamp text, status text, app text, duration real, isArchived int, audio blob);
      insert into History values
        ('a', 'hey sam', 'Hey Sam.', 'something else entirely', '2026-11-16 13:44:31.370 +00:00', 'formatted', 'Discord', 2.5, 0, x'00'),
        ('b', '', '', null, '2026-11-16 13:45:00.000 +00:00', 'raw_transcript', 'Discord', 1, 0, null),
        ('c', 'old', 'Old.', null, '2026-11-16 13:46:00.000 +00:00', 'formatted', 'Zed', 1, 1, null),
        ('d', 'hi', 'Hi.', null, '2026-11-16 13:47:00.000 +00:00', 'dismissed', 'Zed', 1, 0, null);
    `);
    fs.writeFileSync(path.join(root, 'Wispr Flow', 'config.json'), JSON.stringify({ prefs: { user: {
      personalizationStyles: { personal: 'casual', work: 'formal', email: 'formal', other: 'very casual', unset: 'default' },
      autoCleanup: { level: 'high' },
      shouldAutoLearnWords: false,
    } } }));

    const [wispr] = readOtherApps(root);
    expect(wispr.words).toEqual([
      { word: 'Supabase', manual: true },
      { word: 'handoff', heardAs: 'hand of', manual: false },
    ]);
    expect(wispr.snippets).toEqual([{ trigger: 'my sig', expansion: 'Best,\nSam' }]);
    // The formatted text, never Wispr's editedText; empty, archived, and dismissed entries are skipped.
    expect(wispr.history).toEqual([{ createdAt: '2026-11-16T13:44:31.370Z', mode: 'dictate', text: 'Hey Sam.', rawText: 'hey sam', durationMs: 2500, application: 'Discord' }]);
    expect(wispr.settings).toEqual({ styles: { Messaging: 'casual', Email: 'formal', default: 'very-casual' }, cleanup: 'medium', learnWords: false });
    expect(wispr.notes.join(' ')).toMatch(/personal and work/);
  });

  it('reads Typeless dictation, translations, and Ask, and still imports when a column is missing', () => {
    const root = appData();
    const meta = (value: object) => `'${JSON.stringify(value)}'`;
    database(path.join(root, 'Typeless.exe', 'typeless.db'), `
      create table history_v2 (id text, status text, mode text, refined_text text, created_at text, mode_meta text);
      insert into history_v2 values
        ('1', 'completed', 'voice_transcript', 'Hello there.', '2026-07-11T13:44:00.733Z', null),
        ('2', 'completed', 'voice_translation', 'مرحبا', '2026-07-12T10:00:00.000Z', ${meta({ output_language: 'ar-EG' })}),
        ('3', 'completed', 'voice_command', 'Paris.', '2026-07-13T10:00:00.000Z', ${meta({ ai_result: { user_prompt: 'Capital of France?' } })}),
        ('4', 'dismissed', 'voice_transcript', null, '2026-07-14T10:00:00.000Z', null);
    `);
    const [typeless] = readOtherApps(root);
    expect(typeless.name).toBe('Typeless');
    expect(typeless.history).toEqual([
      { createdAt: '2026-07-11T13:44:00.733Z', mode: 'dictate', text: 'Hello there.', durationMs: undefined },
      { createdAt: '2026-07-12T10:00:00.000Z', mode: 'translate', text: 'مرحبا', targetLanguage: 'ar-EG', durationMs: undefined },
      { createdAt: '2026-07-13T10:00:00.000Z', mode: 'ask', text: 'Paris.', rawText: 'Capital of France?', answer: 'Paris.', durationMs: undefined },
    ]);
    expect(typeless.notes.join(' ')).toMatch(/dictionary/);
  });

  it('finds nothing when neither app is installed', () => {
    expect(readOtherApps(appData())).toEqual([]);
  });

  it('reads both apps’ date formats', () => {
    expect(readDate('2026-11-16 13:44:25.254 +00:00')).toBe('2026-11-16T13:44:25.254Z');
    expect(readDate('2026-11-16 15:44:25 +02:00')).toBe('2026-11-16T13:44:25.000Z');
    expect(readDate('2026-07-11T13:44:00.733Z')).toBe('2026-07-11T13:44:00.733Z');
    expect(readDate('yesterday')).toBeUndefined();
  });
});

describe('Importing from another app', () => {
  const wispr: OtherAppData = {
    app: 'wispr-flow',
    name: 'Wispr Flow',
    words: [
      { word: 'Supabase', manual: true },
      { word: 'handoff', heardAs: 'hand of', manual: false },
      { word: 'Vercel', manual: true },
    ],
    snippets: [
      { trigger: 'my sig', expansion: 'Best, Sam' },
      { trigger: 'my address', expansion: '1 Main St' },
      { trigger: '!!!', expansion: 'nothing' },
    ],
    history: [
      { createdAt: '2026-11-16T13:44:31.370Z', mode: 'dictate', text: 'Hey Sam.', rawText: 'hey sam', durationMs: 2500, application: 'Discord' },
      { createdAt: '2026-11-15T10:00:00.000Z', mode: 'dictate', text: 'Ship it.', application: 'explorer' },
    ],
    settings: { styles: { Messaging: 'casual', Email: 'formal', default: 'casual' }, cleanup: 'medium', learnWords: false },
    notes: [],
  };

  function state(): ImportState {
    const initial = getInitialState();
    return {
      ...initial,
      dictionary: [
        { id: 'd1', word: 'supabase', source: 'manual', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'd2', word: 'Handoff', source: 'manual', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
      snippets: [{ id: 's1', trigger: 'My address', expansion: 'old', createdAt: '2026-01-01T00:00:00.000Z' }],
      history: [],
      settings: {
        ...initial.settings,
        historyRetention: 'forever',
        defaultStyle: '',
        styleCorrections: { Email: { tone: 'Casual', phrasing: 'Capitalized sentences and names, no period after the last sentence', since: '2026-01-01T00:00:00.000Z' } },
        smartCleanup: true,
        cleanupLevel: 'light',
        learnFromEdits: true,
      },
    };
  }

  it('reviews what is new, already there, or would replace a choice the user made', () => {
    const plan = planImport(wispr, state(), 'groq');
    expect(plan.words.map((item) => [item.word, item.status])).toEqual([['Supabase', 'exists'], ['handoff', 'adds-heard-as'], ['Vercel', 'new']]);
    expect(plan.snippets.map((item) => item.status)).toEqual(['new', 'exists', 'invalid']);
    expect(plan.styles).toEqual([
      { category: 'Messaging', style: 'casual', status: 'new' },
      { category: 'Email', style: 'formal', status: 'different' },
      { category: 'default', style: 'casual', status: 'new' },
    ]);
    expect(plan.cleanup).toEqual({ level: 'medium', same: false });
    expect(plan.stopLearningFromEdits).toBe(true);
    // A system app is not an app the user writes in.
    expect(plan.history.map((item) => item.writingSource)).toEqual(['discord', undefined]);

    const selection = defaultSelection(plan);
    expect(selection.styles).toEqual(['Messaging', 'default']);
    expect(selection.snippets).toEqual(['my sig']);
  });

  it('imports the selection, skips repeats on a second import, and undoes everything', () => {
    const before = state();
    const plan = planImport(wispr, before, 'groq');
    const { state: after, receipt, added } = applyImport(before, plan, defaultSelection(plan), '2026-11-21T00:00:00.000Z');

    expect(added).toEqual({ words: 1, heardAs: 1, snippets: 1, history: 2, settings: 4 });
    expect(after.dictionary.find((entry) => entry.word === 'Handoff')?.heardAs).toBe('hand of');
    expect(after.snippets.map((item) => item.trigger)).toEqual(['my sig', 'My address']);
    expect(after.history.map((item) => item.text)).toEqual(['Hey Sam.', 'Ship it.']);
    expect(after.history[0]).toMatchObject({ model: 'Wispr Flow', rawText: 'hey sam', durationMs: 2500 });
    expect(after.settings.styleCorrections.Messaging).toMatchObject({ tone: 'Casual' });
    // The Email style the user picked stays: it was not ticked.
    expect(after.settings.styleCorrections.Email.phrasing).toBe(before.settings.styleCorrections.Email.phrasing);
    expect(after.settings).toMatchObject({ defaultStyle: 'casual', cleanupLevel: 'medium', smartCleanup: true, learnFromEdits: false });

    const again = planImport(wispr, after, 'groq');
    expect(again.history).toEqual([]);
    expect(again.historyDuplicates).toBe(2);
    expect(defaultSelection(again).words).toEqual([]);

    const undone = undoImport(after, receipt, after);
    expect(undone.dictionary).toEqual(before.dictionary);
    expect(undone.snippets).toEqual(before.snippets);
    expect(undone.history).toEqual([]);
    expect(undone.settings).toEqual(before.settings);
  });

  it('keeps History retention when importing', () => {
    const current = { ...state(), settings: { ...state().settings, historyRetention: '24h' as const } };
    const plan = planImport(wispr, current, 'groq');
    const { added, state: after } = applyImport(current, plan, defaultSelection(plan));
    expect(added.history).toBe(0);
    expect(after.history).toEqual([]);
  });

  it('turns AI cleanup off for an app that pasted exactly what was said', () => {
    const plan = planImport({ ...wispr, settings: { cleanup: 'none' } }, state(), 'groq');
    expect(applyImport(state(), plan, defaultSelection(plan)).state.settings.smartCleanup).toBe(false);
  });
});
