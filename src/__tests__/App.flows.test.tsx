// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DictionaryEntry, HistoryItem, SettingsState, Snippet, WritingSample } from '../types/app';

// Tests stop at the module edges: no microphone, network, sound, or saved store.
const engine = vi.hoisted(() => ({
  transcribeAudio: vi.fn(),
  processTranscriptWithLlm: vi.fn(),
  detectWritingStyle: vi.fn(),
}));
vi.mock('../services/providers/engine', async (importActual) => ({ ...await importActual<object>(), ...engine }));

const store = vi.hoisted(() => ({ loaded: undefined as unknown, saves: [] as unknown[] }));
vi.mock('../services/storage', async (importActual) => {
  const actual = await importActual<typeof import('../services/storage')>();
  return {
    ...actual,
    loadPersistedState: vi.fn(async () => store.loaded),
    savePersistedState: vi.fn(async (state: unknown) => { store.saves.push(state); }),
  };
});

vi.mock('../utils/audioRecorder', async (importActual) => ({
  ...await importActual<object>(),
  startAudioRecording: vi.fn(async () => ({
    stop: async () => ({ blob: new Blob(['audio']), durationMs: 3000, dataUrl: undefined, mimeType: 'audio/webm' }),
    cancel: vi.fn(),
  })),
}));
vi.mock('../utils/sounds', () => ({ playInteractionSound: vi.fn() }));

const { App } = await import('../App');
const { getInitialState } = await import('../services/storage');
const { startAudioRecording } = await import('../utils/audioRecorder');

type Context = { application?: string; domain?: string; textBefore?: string; textAfter?: string };
type PasteEdits = { words: string[]; edited?: string };

const desktop = {
  trigger: undefined as ((mode: string) => void) | undefined,
  phase: undefined as ((phase: string) => void) | undefined,
  action: undefined as ((action: { type: string }) => void) | undefined,
  context: {} as Context,
  edits: { words: [] } as PasteEdits,
  api: {} as Record<string, ReturnType<typeof vi.fn>>,
};

function installDesktop() {
  desktop.api = {
    onTriggerMode: vi.fn((callback) => { desktop.trigger = callback; return () => undefined; }),
    onHudAction: vi.fn((callback) => { desktop.action = callback; return () => undefined; }),
    onShortcutPhase: vi.fn((callback) => { desktop.phase = callback; return () => undefined; }),
    toggleHud: vi.fn(),
    captureDictationContext: vi.fn(async () => desktop.context),
    pasteText: vi.fn(async () => true),
    copyText: vi.fn(async () => undefined),
    watchPasteCorrections: vi.fn(async () => desktop.edits),
    setSystemMute: vi.fn(async () => undefined),
  };
  (window as unknown as { yapyap: unknown }).yapyap = { ...desktop.api, platform: 'win32' };
}

const sample = (category: string, extra: Partial<WritingSample> = {}): WritingSample => ({ category, tone: 'Formal', phrasing: '', ...extra });

let nextId = 0;
function dictation(writingSample?: WritingSample, extra: Partial<HistoryItem> = {}): HistoryItem {
  nextId += 1;
  return {
    id: `h-old-${nextId}`, createdAt: new Date(Date.UTC(2026, 0, nextId)).toISOString(), mode: 'dictate',
    rawText: 'old text', text: 'Old text.', durationMs: 2000, wordCount: 2, wpm: 60, providerId: 'groq', model: 'whisper',
    writingSample, ...extra,
  } as HistoryItem;
}

function seed({ settings = {}, history = [], dictionary = [], snippets = [] }: { settings?: Partial<SettingsState>; history?: HistoryItem[]; dictionary?: DictionaryEntry[]; snippets?: Snippet[] } = {}) {
  const initial = getInitialState();
  store.loaded = {
    ...initial,
    history,
    dictionary,
    snippets,
    providers: { ...initial.providers, groq: { ...initial.providers.groq, apiKey: 'test-key' } },
    settings: {
      ...initial.settings,
      activeSttProvider: 'groq', activeLlmProvider: 'groq', interactionSounds: false, muteWhenDictating: false,
      smartCleanup: true, personalizationEnabled: true, contextAwareness: true, learnFromEdits: true,
      ...settings,
    },
  };
}

/** Records, stops, and waits until the dictation is pasted and its follow-up work has run. */
async function dictate(mode = 'dictate') {
  render(<App />);
  await waitFor(() => expect(desktop.trigger).toBeDefined());
  await act(async () => { desktop.trigger!(mode); });
  await waitFor(() => expect(desktop.api.onHudAction).toHaveBeenCalled());
  await act(async () => { desktop.action!({ type: 'stop' }); });
  await waitFor(() => expect(desktop.api.pasteText).toHaveBeenCalled());
  // Learning and the paste watch run after delivery.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

const lastHud = () => desktop.api.toggleHud.mock.calls.at(-1)?.[1] as { status: string } | undefined;

const lastSaved = () => store.saves.at(-1) as { history: HistoryItem[]; dictionary: { word: string }[] };
const cleanupOptions = () => engine.processTranscriptWithLlm.mock.calls[0][3];

beforeAll(() => {
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })) as unknown as typeof window.matchMedia;
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.open = false; };
  HTMLElement.prototype.showPopover = function showPopover() {};
  HTMLElement.prototype.hidePopover = function hidePopover() {};
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  store.saves = [];
  desktop.trigger = undefined;
  desktop.phase = undefined;
  desktop.action = undefined;
  desktop.context = { domain: 'mail.google.com', textBefore: '', textAfter: '' };
  desktop.edits = { words: [] };
  installDesktop();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No network in tests'); }));
  engine.transcribeAudio.mockResolvedValue('hey sam see you soon');
  engine.processTranscriptWithLlm.mockResolvedValue({ finalText: 'Hey Sam. See you soon.' });
  engine.detectWritingStyle.mockResolvedValue(sample('Email', { phrasing: 'Capitalized, periods' }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  delete (window as unknown as { yapyap?: unknown }).yapyap;
});

describe('Dictation flow', () => {
  it('cleans up, pastes, and learns the style of a dictation', async () => {
    seed();
    await dictate();

    expect(desktop.api.pasteText).toHaveBeenCalledWith('Hey Sam. See you soon.');
    expect(engine.detectWritingStyle).toHaveBeenCalledWith('hey sam see you soon', expect.anything(), expect.objectContaining({ category: 'Email' }));
    await waitFor(() => expect(lastSaved().history[0]).toMatchObject({ text: 'Hey Sam. See you soon.', writingSource: 'mail.google.com', writingSample: { category: 'Email' } }));
  });

  it('drops a dictation cancelled while it is still processing', async () => {
    seed();
    let finish: (text: string) => void = () => undefined;
    engine.transcribeAudio.mockReturnValueOnce(new Promise<string>((resolve) => { finish = resolve; }));
    render(<App />);
    await waitFor(() => expect(desktop.trigger).toBeDefined());
    await act(async () => { desktop.trigger!('dictate'); });
    await waitFor(() => expect(desktop.api.onHudAction).toHaveBeenCalled());
    await act(async () => { desktop.action!({ type: 'stop' }); });
    await waitFor(() => expect(engine.transcribeAudio).toHaveBeenCalled());
    await act(async () => { desktop.action!({ type: 'cancel' }); });
    await act(async () => {
      finish('hey sam see you soon');
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(desktop.api.pasteText).not.toHaveBeenCalled();
    expect(lastSaved().history).toHaveLength(0);
    expect(lastHud()?.status).toBe('cancelled');
  });

  it('brings back a dictation cancelled while processing with Undo', async () => {
    seed();
    engine.transcribeAudio.mockReturnValueOnce(new Promise<string>(() => undefined));
    render(<App />);
    await waitFor(() => expect(desktop.trigger).toBeDefined());
    await act(async () => { desktop.trigger!('dictate'); });
    await waitFor(() => expect(desktop.api.onHudAction).toHaveBeenCalled());
    await act(async () => { desktop.action!({ type: 'stop' }); });
    await waitFor(() => expect(engine.transcribeAudio).toHaveBeenCalled());
    await act(async () => { desktop.action!({ type: 'cancel' }); });
    expect(lastHud()?.status).toBe('cancelled');
    await act(async () => {
      desktop.action!({ type: 'undo' });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(engine.transcribeAudio).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(desktop.api.pasteText).toHaveBeenCalledWith('Hey Sam. See you soon.'));
  });

  it('quietly drops a recording stopped right after it started', async () => {
    seed();
    vi.mocked(startAudioRecording).mockResolvedValueOnce({
      stop: async () => ({ blob: new Blob([]), durationMs: 150, dataUrl: undefined, mimeType: 'audio/webm' }),
      cancel: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof startAudioRecording>>);
    render(<App />);
    await waitFor(() => expect(desktop.trigger).toBeDefined());
    await act(async () => { desktop.trigger!('dictate'); });
    await waitFor(() => expect(desktop.api.onHudAction).toHaveBeenCalled());
    await act(async () => { desktop.action!({ type: 'stop' }); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    expect(engine.transcribeAudio).not.toHaveBeenCalled();
    expect(lastHud()?.status).toBe('processing');
    await waitFor(() => expect(lastHud()).toMatchObject({ status: 'notice', noticeText: 'No speech detected' }), { timeout: 1500 });
  });

  it('drops a recording in which nothing was said', async () => {
    seed();
    vi.mocked(startAudioRecording).mockResolvedValueOnce({
      stop: async () => ({ blob: new Blob(['audio']), durationMs: 4000, dataUrl: undefined, mimeType: 'audio/webm', heardSpeech: false }),
      cancel: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof startAudioRecording>>);
    render(<App />);
    await waitFor(() => expect(desktop.trigger).toBeDefined());
    await act(async () => { desktop.trigger!('dictate'); });
    await waitFor(() => expect(desktop.api.onHudAction).toHaveBeenCalled());
    await act(async () => { desktop.action!({ type: 'stop' }); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    expect(engine.transcribeAudio).not.toHaveBeenCalled();
    expect(lastHud()?.status).toBe('processing');
    await waitFor(() => expect(lastHud()).toMatchObject({ status: 'notice', noticeText: 'No speech detected' }), { timeout: 1500 });
  });

  it('records with strong noise reduction only when it is on', async () => {
    seed({ settings: { strongNoiseReduction: true } });
    await dictate();
    expect(vi.mocked(startAudioRecording).mock.calls[0][2]).toEqual({ strongNoiseReduction: true });
  });

  it('transcribes in the languages the user speaks, auto-detecting by default', async () => {
    expect(getInitialState().settings.spokenLanguages).toEqual([]);
    seed({ settings: { spokenLanguages: ['Arabic'] } });
    await dictate();
    expect(engine.transcribeAudio.mock.calls[0][2]).toMatchObject({ spokenLanguages: ['Arabic'] });
  });

  it('keeps strong noise reduction off by default', () => {
    expect(getInitialState().settings.strongNoiseReduction).toBe(false);
  });

  it('closes the shortcut placeholder when no API key is set', async () => {
    seed();
    const loaded = store.loaded as { providers: Record<string, { apiKey: string }> };
    loaded.providers.groq.apiKey = '';
    render(<App />);
    await waitFor(() => expect(desktop.phase).toBeDefined());
    await act(async () => { desktop.phase!('armed'); });
    expect(lastHud()?.status).toBe('armed');
    await act(async () => { desktop.trigger!('dictate'); });
    expect(lastHud()?.status).toBe('idle');
  });

  it('keeps an error on screen when Alt is pressed without a shortcut', async () => {
    seed();
    engine.transcribeAudio.mockRejectedValueOnce(new Error('Network down'));
    render(<App />);
    await waitFor(() => expect(desktop.trigger).toBeDefined());
    await act(async () => { desktop.trigger!('dictate'); });
    await waitFor(() => expect(desktop.api.onHudAction).toHaveBeenCalled());
    await act(async () => { desktop.action!({ type: 'stop' }); });
    await waitFor(() => expect(lastHud()?.status).toBe('error'));
    await act(async () => { desktop.phase!('armed'); desktop.phase!('closed'); });
    expect(lastHud()?.status).toBe('error');
  });

  it('does not apply a style learned from a single dictation', async () => {
    seed({ history: [dictation(sample('Email'))] });
    await dictate();
    expect(cleanupOptions().writingStyles).toEqual([]);
  });

  it('applies a learned style after 3 dictations', async () => {
    seed({ history: [1, 2, 3].map(() => dictation(sample('Email'))) });
    await dictate();
    expect(cleanupOptions().writingStyles).toEqual([expect.objectContaining({ category: 'Email', count: 3 })]);
  });

  it('counts a hand-corrected dictation right away', async () => {
    seed({ history: [dictation(sample('Email', { phrasing: 'Sentence case' }), { writingCorrection: true, writingCorrectedAt: '2026-01-02T00:00:00.000Z' })] });
    await dictate();
    expect(cleanupOptions().writingStyles).toEqual([expect.objectContaining({ category: 'Email', corrections: 1 })]);
  });

  it('cleans up but learns nothing where the user chose Don\'t learn here', async () => {
    seed({ settings: { sourceCategories: { 'mail.google.com': 'off' } } });
    desktop.edits = { words: [], edited: 'hey sam see you soon' };
    await dictate();

    expect(engine.processTranscriptWithLlm).toHaveBeenCalled();
    expect(engine.detectWritingStyle).not.toHaveBeenCalled();
    expect(lastSaved().history[0].writingSample).toBeUndefined();
  });

  it('keeps applying writing rules with personalization off, but learns and watches nothing', async () => {
    seed({ settings: { personalizationEnabled: false, writingPreferences: 'Write numbers as digits' } });
    await dictate();

    expect(cleanupOptions()).toMatchObject({ writingPreferences: 'Write numbers as digits', writingStyles: undefined });
    expect(engine.detectWritingStyle).not.toHaveBeenCalled();
    expect(desktop.api.watchPasteCorrections).not.toHaveBeenCalled();
  });

  it('does not read the text after a paste with Learn from my edits off', async () => {
    seed({ settings: { learnFromEdits: false } });
    await dictate();
    expect(desktop.api.watchPasteCorrections).not.toHaveBeenCalled();
  });

  it('sends the text near the caret only with context awareness on', async () => {
    seed({ settings: { contextAwareness: false } });
    desktop.context = { domain: 'mail.google.com', textBefore: 'Hi Sam,', textAfter: 'Thanks' };
    await dictate();

    expect(cleanupOptions().destination).toEqual({ domain: 'mail.google.com', application: undefined, textBefore: undefined, textAfter: undefined });
    expect(engine.detectWritingStyle.mock.calls[0][2].existingWriting).toBeUndefined();
  });
});

describe('Starting styles', () => {
  it('applies a picked style from the first dictation in that kind of place', async () => {
    seed({ settings: { styleCorrections: { Messaging: { tone: 'Casual', phrasing: 'all lowercase, light punctuation, no period at the end' } } } });
    desktop.context = { domain: 'app.slack.com', textBefore: '', textAfter: '' };
    await dictate();
    expect(cleanupOptions().writingStyles).toEqual([expect.objectContaining({ category: 'Messaging', phrasing: 'all lowercase, light punctuation, no period at the end' })]);
  });
});

describe('Default writing style', () => {
  it('applies the default style in a kind of place with nothing picked or learned', async () => {
    seed({ settings: { defaultStyle: 'very-casual' } });
    desktop.context = { domain: 'app.slack.com', textBefore: '', textAfter: '' };
    await dictate();
    expect(cleanupOptions().writingStyles).toEqual([expect.objectContaining({ category: 'Messaging', phrasing: expect.stringMatching(/lowercase/) })]);
  });
});

describe('Snippets', () => {
  const signature: Snippet = { id: 's-1', trigger: 'my signature', expansion: 'best,\nSam Lee', createdAt: '2026-01-01T00:00:00.000Z' };

  it('pastes a snippet exactly as saved when only its trigger is said, with no cleanup or learning', async () => {
    seed({ snippets: [signature] });
    engine.transcribeAudio.mockResolvedValue('My signature.');
    desktop.context = { domain: 'mail.google.com', textBefore: 'Thanks for the help. ', textAfter: '' };
    await dictate();

    expect(desktop.api.pasteText).toHaveBeenCalledWith('best,\nSam Lee');
    expect(engine.processTranscriptWithLlm).not.toHaveBeenCalled();
    expect(engine.detectWritingStyle).not.toHaveBeenCalled();
    await waitFor(() => expect(lastSaved().history[0].text).toBe('best,\nSam Lee'));
  });

  it('expands a trigger inside a sentence after cleanup and learns nothing from it', async () => {
    seed({ snippets: [signature] });
    desktop.edits = { words: [], edited: 'talk soon, best, sam lee' };
    engine.transcribeAudio.mockResolvedValue('talk soon my signature');
    engine.processTranscriptWithLlm.mockResolvedValue({ finalText: 'Talk soon. My signature.' });
    await dictate();

    expect(desktop.api.pasteText).toHaveBeenCalledWith('Talk soon. best,\nSam Lee');
    expect(engine.processTranscriptWithLlm.mock.calls[0][0]).toBe('talk soon my signature');
    // Cleanup is asked to keep the phrase, and never sees the text it inserts.
    const options = engine.processTranscriptWithLlm.mock.calls[0][3];
    expect(options.keepPhrases).toEqual(['my signature']);
    expect(JSON.stringify(options)).not.toContain('Sam Lee');
    expect(engine.detectWritingStyle).not.toHaveBeenCalled();
    expect(lastSaved().dictionary.map((entry) => entry.word)).not.toContain('Sam Lee');
  });

  it('leaves a trigger the recognizer punctuated inside, even when cleanup drops that punctuation', async () => {
    seed({ snippets: [{ ...signature, trigger: 'my address12', expansion: 'egypt' }] });
    engine.transcribeAudio.mockResolvedValue('My address: 12 October City.');
    engine.processTranscriptWithLlm.mockResolvedValue({ finalText: 'My address 12 October City.' });
    await dictate();

    expect(desktop.api.pasteText).toHaveBeenCalledWith('My address 12 October City.');
    expect(engine.processTranscriptWithLlm.mock.calls[0][3].keepPhrases).toEqual([]);
  });

  it('expands a trigger cleanup wrote plainly when the recognizer wrote it in words the app cannot read', async () => {
    seed({ snippets: [{ ...signature, trigger: 'عنوان 121', expansion: 'مثر' }] });
    engine.transcribeAudio.mockResolvedValue('عنوان مية وواحد وعشرين، مصر');
    engine.processTranscriptWithLlm.mockResolvedValue({ finalText: 'عنوان 121، مصر' });
    await dictate();

    expect(desktop.api.pasteText).toHaveBeenCalledWith('مثر، مصر');
  });

  it('undoes and redoes the AI edit of a dictation, keeping dictionary spellings and snippets', async () => {
    seed({
      history: [dictation(undefined, { rawText: 'um send it to my address 12 please, yep yep', text: 'Send it to egypt, please, Yap Yap.', plainText: 'um send it to egypt please, Yap Yap' })],
      snippets: [{ ...signature, trigger: 'my address12', expansion: 'egypt' }],
      dictionary: [{ id: 'd1', word: 'Yap Yap', heardAs: 'yep yep', source: 'manual', createdAt: '2026-01-01T00:00:00.000Z' }],
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^History$/ }));
    const menu = async () => user.click(screen.getAllByRole('button', { name: 'More actions' })[0]);

    await menu();
    await user.click(screen.getByRole('button', { name: 'Undo AI edit' }));
    await waitFor(() => expect(lastSaved().history[0]).toMatchObject({ text: 'um send it to egypt please, Yap Yap', aiText: 'Send it to egypt, please, Yap Yap.' }));

    await menu();
    await user.click(screen.getByRole('button', { name: 'Redo AI edit' }));
    await waitFor(() => expect(lastSaved().history[0].text).toBe('Send it to egypt, please, Yap Yap.'));
    expect(lastSaved().history[0].aiText).toBeUndefined();
  });

  it('saves the text without the AI edit with each dictation, and undo uses it as saved', async () => {
    seed({ dictionary: [{ id: 'd1', word: 'Sam', heardAs: 'sem', source: 'manual', createdAt: '2026-01-01T00:00:00.000Z' }] });
    engine.transcribeAudio.mockResolvedValue('hey sem see you soon');
    await dictate();
    await waitFor(() => expect(lastSaved().history[0].plainText).toBe('hey Sam see you soon'));
    cleanup();

    // A later dictionary change does not alter what undo shows.
    seed({ history: [dictation(undefined, { rawText: 'hey sem', text: 'Hey Sam.', plainText: 'hey Sam' })] });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^History$/ }));
    await user.click(screen.getAllByRole('button', { name: 'More actions' })[0]);
    await user.click(screen.getByRole('button', { name: 'Undo AI edit' }));
    await waitFor(() => expect(lastSaved().history[0].text).toBe('hey Sam'));
  });

  it('offers no AI edit to undo when cleanup changed nothing, or for a dictation saved before undo existed', async () => {
    seed({ history: [dictation(undefined, { rawText: 'Hello there.', text: 'Hello there.', plainText: 'Hello there.' }), dictation(undefined, { rawText: 'hi', text: 'Hi.' })] });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^History$/ }));
    await user.click(screen.getAllByRole('button', { name: 'More actions' })[0]);
    expect(screen.queryByRole('button', { name: 'Undo AI edit' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: 'More actions' })[1]);
    expect(screen.queryByRole('button', { name: 'Undo AI edit' })).toBeNull();
  });

  it('expands with cleanup off and with personalization off', async () => {
    seed({ snippets: [signature], settings: { smartCleanup: false, personalizationEnabled: false } });
    engine.transcribeAudio.mockResolvedValue('talk soon my signature');
    await dictate();
    expect(desktop.api.pasteText).toHaveBeenCalledWith('talk soon best,\nSam Lee');
  });

  it('does not expand a translation', async () => {
    seed({ snippets: [signature], settings: { translationTargets: ['Spanish'] } });
    engine.processTranscriptWithLlm.mockResolvedValue({ finalText: 'my signature' });
    await dictate('translate');
    expect(desktop.api.pasteText).toHaveBeenCalledWith('my signature');
  });
});

describe('Dictionary replacements', () => {
  const handoff: DictionaryEntry = { id: 'd-1', word: 'handoff', source: 'manual', createdAt: '2026-01-01T00:00:00.000Z', heardAs: 'hand of' };

  it('replaces a heard-as spelling after cleanup, in History and the paste', async () => {
    seed({ dictionary: [handoff] });
    engine.processTranscriptWithLlm.mockResolvedValue({ finalText: 'Hand of is done.' });
    await dictate();

    expect(desktop.api.pasteText).toHaveBeenCalledWith('Handoff is done.');
    expect(engine.transcribeAudio.mock.calls[0][2].dictionaryWords).toEqual(['handoff']);
    await waitFor(() => expect(lastSaved().history[0].text).toBe('Handoff is done.'));
  });

  it('replaces a heard-as spelling with cleanup off', async () => {
    seed({ dictionary: [handoff], settings: { smartCleanup: false } });
    engine.transcribeAudio.mockResolvedValue('the hand of is done');
    await dictate();

    expect(engine.processTranscriptWithLlm).not.toHaveBeenCalled();
    expect(desktop.api.pasteText).toHaveBeenCalledWith('the handoff is done');
  });
});

describe('Learning from edits after a paste', () => {
  it('learns the style of the corrected text and adds respelled words to the dictionary', async () => {
    seed();
    desktop.edits = { words: ['Supabase'], edited: 'hey sam see you soon' };
    engine.detectWritingStyle
      .mockResolvedValueOnce(sample('Email', { phrasing: 'Capitalized, periods' }))
      .mockResolvedValueOnce(sample('Email', { phrasing: 'all lowercase, no punctuation', fromUserText: true }));
    await dictate();

    expect(desktop.api.watchPasteCorrections).toHaveBeenCalledWith('Hey Sam. See you soon.');
    await waitFor(() => expect(engine.detectWritingStyle).toHaveBeenCalledTimes(2));
    expect(engine.detectWritingStyle.mock.calls[1]).toEqual(['hey sam see you soon', expect.anything(), expect.objectContaining({ before: 'Hey Sam. See you soon.' })]);
    await waitFor(() => expect(lastSaved().history[0].writingSample).toMatchObject({ phrasing: 'all lowercase, no punctuation', fromUserText: true, fromEdit: true }));
    expect(lastSaved().dictionary.map((entry) => entry.word)).toContain('Supabase');
  });

  it('ignores an edit that only changes words', async () => {
    seed();
    desktop.edits = { words: [], edited: 'Hey Sam. See you tomorrow.' };
    await dictate();
    expect(engine.detectWritingStyle).toHaveBeenCalledTimes(1);
  });
});
