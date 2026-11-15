import { applyStyleCorrections, parseStyleCorrections, buildSourceCategories, buildWritingProfiles, categoryForDestination, destinationKey, fitToSurroundingText, parseWritingPreferences, parseWritingSample, personalizationScore, writingRulesFor } from '../services/personalization';
import { browserDomain } from '../../electron/dictationContext';
import { extractCorrections, watchPasteCorrections } from '../../electron/pasteCorrections';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  buildHeatmapWeeks,
  classifyTranscriptCategory,
  computeInsights,
  countWords,
  extractAutoDictionaryWords,
  filterByRetention,
  formatDurationParts,
  formatWordCount,
} from '../services/stats';
import { getInitialState, sanitizeLoadedState } from '../services/storage';
import { createDefaultProviders, PROVIDER_CATALOG, isProviderConfigured } from '../services/providers/catalog';
import {
  detectWritingStyle,
  listProviderModels,
  processTranscriptWithLlm,
  proposeWritingPreferences,
  testProviderConnection,
  transcribeAudio,
} from '../services/providers/engine';
import { parseDictionaryImportText } from '../components/DictionaryView';
import { HistoryItem } from '../types/app';
import { assignHistoryIds, parseHistoryImport } from '../services/historyImport';
import { matchShortcut, needsMenuMask } from '../../electron/shortcutMatch';
import { UiohookKey as Key } from 'uiohook-napi';

describe('Saved shortcuts', () => {
  it('keeps the first assignment and removes repeated chords regardless of key order', () => {
    const { settings } = getInitialState();
    const shortcuts = {
      dictate: [['Right Alt'], ['Left Ctrl', 'K'], ['K', 'Left Ctrl']],
      translate: [['Right Shift', 'Right Alt'], ['Right Alt']],
      ask: [['Right Alt', 'Right Shift'], ['Right Alt', 'Space']],
    };
    const loaded = sanitizeLoadedState({ settings: { ...settings, shortcuts } });

    expect(loaded.settings.shortcuts).toEqual({
      dictate: [['Right Alt'], ['Left Ctrl', 'K']],
      translate: [['Right Shift', 'Right Alt']],
      ask: [['Right Alt', 'Space']],
    });
  });

  it('removes equivalent global accelerators while retaining distinct sided modifier chords', () => {
    const { settings } = getInitialState();
    const shortcuts = {
      dictate: [['Left Shift'], ['Left Ctrl', 'K']],
      translate: [['Right Shift'], ['K', 'Right Ctrl']],
      ask: [['Shift'], ['Right Ctrl', 'L']],
    };
    const loaded = sanitizeLoadedState({ settings: { ...settings, shortcuts } });

    expect(loaded.settings.shortcuts).toEqual({
      dictate: [['Left Shift'], ['Left Ctrl', 'K']],
      translate: [['Right Shift']],
      ask: [['Right Ctrl', 'L']],
    });
  });
});

describe('Saved provider connections', () => {
  it('preserves explicitly selected model IDs even when they match a legacy migration', () => {
    const { providers } = getInitialState();
    providers.groq = { ...providers.groq, modelsSelected: true, llmModel: 'llama-3.3-70b-versatile' };

    expect(sanitizeLoadedState({ providers }).providers.groq.llmModel).toBe('llama-3.3-70b-versatile');
  });

  it('keeps a verified keyless connection at the default local endpoint after reload', () => {
    const { providers } = getInitialState();
    providers.custom.status = 'connected';

    const { providers: restored } = sanitizeLoadedState({ providers });

    expect(isProviderConfigured(restored.custom)).toBe(true);
  });
});

describe('Windows AltGr shortcuts', () => {
  const dictate = { keys: [[Key.AltRight]] };
  const translate = { keys: [[Key.AltRight], [Key.ShiftRight]] };
  const ask = { keys: [[Key.AltRight], [Key.Space]] };
  const bindings = [dictate, translate, ask];

  it('matches each default binding when Windows supplies a synthetic Ctrl', () => {
    const pressed = new Map<number, number>([[Key.Ctrl, 100], [Key.AltRight, 100]]);
    expect(matchShortcut(bindings, pressed, true)).toBe(dictate);
    expect(matchShortcut(bindings, new Map([...pressed, [Key.ShiftRight, 130]]), true)).toBe(translate);
    expect(matchShortcut(bindings, new Map([...pressed, [Key.Space, 130]]), true)).toBe(ask);
    expect(matchShortcut(bindings, new Map([...pressed, [Key.E, 130]]), true)).toBeUndefined();
  });

  it('masks only chords that would open a menu when released', () => {
    expect(needsMenuMask(new Map([[Key.AltRight, 1]]))).toBe(true);
    expect(needsMenuMask(new Map([[Key.Meta, 1], [Key.Ctrl, 2]]))).toBe(true);
    expect(needsMenuMask(new Map([[Key.Ctrl, 1], [Key.Shift, 2]]))).toBe(false);
  });

  it('preserves a deliberate Ctrl hold and prefers explicitly configured Ctrl chords', () => {
    const intentional = new Map<number, number>([[Key.Ctrl, 100], [Key.AltRight, 300]]);
    const exact = { keys: [[Key.Ctrl], [Key.AltRight]] };
    expect(matchShortcut(bindings, intentional, true)).toBeUndefined();
    expect(matchShortcut([...bindings, exact], new Map([[Key.Ctrl, 100], [Key.AltRight, 100]]), true)).toBe(exact);
  });
});

describe('History import', () => {
  it('preserves entries with colliding, missing, and unusable IDs as independently editable records', () => {
    const imported = parseHistoryImport(JSON.stringify([
      { id: 'existing', text: 'Imported collision' },
      { id: 'duplicate', text: 'First' },
      { id: 'duplicate', text: 'Second' },
      { id: '../recording', text: 'Third' },
      { text: 'Fourth' },
      null,
    ]), 'groq');
    const items = assignHistoryIds(imported, ['existing']);
    expect(items.map((item) => item.text)).toEqual(['Imported collision', 'First', 'Second', 'Third', 'Fourth']);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    expect(items[1].id).toBe('duplicate');
    expect(items.every((item) => /^[a-z0-9_-]+$/i.test(item.id) && item.id !== 'existing')).toBe(true);
  });
});

describe('Stats and Heatmap Engine', () => {
  const baseDate = new Date('2026-11-12T12:00:00Z');
  const items: HistoryItem[] = [
    {
      id: '1',
      createdAt: '2026-11-12T10:00:00Z',
      mode: 'dictate',
      rawText: 'Hello world from Yap Yap',
      text: 'Hello world from Yap Yap',
      durationMs: 3000,
      wordCount: 5,
      wpm: 100,
      providerId: 'groq',
      model: 'whisper-large-v3-turbo',
      category: 'Messaging',
    },
    {
      id: '2',
      createdAt: '2026-11-11T10:00:00Z',
      mode: 'ask',
      rawText: 'Explain TypeScript generics briefly',
      text: 'Generics let components work across types safely.',
      durationMs: 4000,
      wordCount: 7,
      wpm: 105,
      providerId: 'openai',
      model: 'gpt-6-luna',
      category: 'AI assistants',
    },
    {
      id: '3',
      createdAt: '2026-10-01T10:00:00Z',
      mode: 'translate',
      rawText: 'مرحبا بالعالم',
      text: 'Hello world',
      durationMs: 2000,
      wordCount: 2,
      wpm: 60,
      providerId: 'gemini',
      model: 'gemini-3.8-flash',
      category: 'Social platforms',
    },
  ];

  it('computes words, WPM, active days, and consecutive streaks accurately', () => {
    const stats = computeInsights(items, baseDate);
    expect(stats.totalWords).toBe(14);
    expect(stats.activeDays).toBe(3);
    expect(stats.currentStreak).toBe(2);
    expect(stats.longestStreak).toBe(2);
    expect(stats.averageWpm).toBeGreaterThan(80);
  });

  it('formats word counts cleanly', () => {
    expect(formatWordCount(52)).toEqual({ value: '52', unit: 'words' });
    expect(formatWordCount(1)).toEqual({ value: '1', unit: 'word' });
    expect(formatWordCount(6600)).toEqual({ value: '6.6K', unit: 'words' });
  });

  it('counts words including Unicode/Arabic strings', () => {
    expect(countWords('هو الرصيد عندك خلص')).toBe(4);
    expect(countWords('   ')).toBe(0);
  });

  it('filters history by retention policy', () => {
    expect(filterByRetention(items, 'forever', baseDate)).toHaveLength(3);
    expect(filterByRetention(items, '30d', baseDate)).toHaveLength(2);
    expect(filterByRetention(items, '7d', baseDate)).toHaveLength(2);
  });

  it('enforces the new retention limits and preserves the legacy 90-day policy', () => {
    const entries = [0, 1, 2, 90, 91, 365, 366].map((age) => ({
      ...items[0],
      createdAt: new Date(baseDate.getTime() - age * 86_400_000).toISOString(),
    }));
    expect(filterByRetention(entries, '24h', baseDate)).toEqual(entries.slice(0, 2));
    expect(filterByRetention(entries, '90d', baseDate)).toEqual(entries.slice(0, 4));
    expect(filterByRetention(entries, '1y', baseDate)).toEqual(entries.slice(0, 6));
    expect(filterByRetention(entries, 'never', baseDate)).toEqual([]);
  });

  it('builds 28-week heatmap matrix with 196 unique DST-safe calendar days', () => {
    const weeks = buildHeatmapWeeks(items, baseDate, 28);
    expect(weeks).toHaveLength(28);
    expect(weeks[0].days).toHaveLength(7);
    const allCells = weeks.flatMap((w) => w.days);
    const uniqueKeys = new Set(allCells.map((c) => c.dateKey));
    expect(uniqueKeys.size).toBe(28 * 7);
    const activeCells = allCells.filter((d) => d.words > 0);
    expect(activeCells.length).toBe(3);
  });

  it('marks days after today as future and days before the first dictation as no data', () => {
    const allCells = buildHeatmapWeeks(items, baseDate, 28, baseDate).flatMap((w) => w.days);
    // baseDate is a Thursday, so the last week still has Friday and Saturday ahead.
    const future = allCells.filter((c) => c.future);
    expect(future.map((c) => c.dateKey)).toEqual(['2026-11-13', '2026-11-14']);
    expect(future.every((c) => !c.hatched)).toBe(true);

    const beforeFirst = allCells.find((c) => c.dateKey === '2026-09-30');
    expect(beforeFirst).toMatchObject({ hatched: true, usageLabel: 'No data available' });
    const quietDay = allCells.find((c) => c.dateKey === '2026-10-02');
    expect(quietDay).toMatchObject({ hatched: false, future: false, usageLabel: 'No activity' });
  });

  it('starts with 100% clean zero-fake state and 0% personalization when empty', () => {
    const init = getInitialState();
    expect(init.history).toEqual([]);
    expect(init.dictionary).toEqual([]);
    const emptyStats = computeInsights(init.history, baseDate);
    expect(emptyStats.totalWords).toBe(0);
    expect(emptyStats.activeDays).toBe(0);
    expect(emptyStats.averageWpm).toBe(0);
    expect(emptyStats.personalizationPercent).toBe(0);
    expect(emptyStats.categoryBreakdown.every((c) => c.percent === 0)).toBe(true);
  });

  it('formats sub-minute durations in seconds and multi-minute durations in hr/min', () => {
    expect(formatDurationParts(0)).toMatchObject({
      firstVal: 0,
      firstUnit: 'hr',
      secondVal: 0,
      secondUnit: 'min',
    });
    expect(formatDurationParts(18 / 60)).toMatchObject({
      firstVal: 0,
      firstUnit: 'min',
      secondVal: 18,
      secondUnit: 'sec',
    });
    expect(formatDurationParts(179)).toMatchObject({
      firstVal: 2,
      firstUnit: 'hr',
      secondVal: 59,
      secondUnit: 'min',
    });
  });

  it('classifies transcripts across all 4 Personalization categories and extracts technical terms', () => {
    expect(classifyTranscriptCategory('Fix the TypeScript git commit bug in api', 'dictate')).toBe(
      'Development tools'
    );
    expect(classifyTranscriptCategory('Post this thread on Twitter and Reddit', 'dictate')).toBe(
      'Social platforms'
    );
    expect(classifyTranscriptCategory('Explain how neural networks work', 'ask')).toBe(
      'AI assistants'
    );
    expect(classifyTranscriptCategory('Hey let us meet tomorrow at 5', 'dictate')).toBe(
      'Messaging'
    );

    const extracted = extractAutoDictionaryWords(
      'Deploy to apivault.tech using useCallback and safeStorage',
      ['useCallback']
    );
    expect(extracted).toContain('apivault.tech');
    expect(extracted).toContain('safeStorage');
    expect(extracted).not.toContain('useCallback');
  });
});

describe('Dictionary CSV/Text Parsing', () => {
  it('parses newline, comma, and semicolon separated terms cleanly', () => {
    const parsed = parseDictionaryImportText(
      '"apivault.tech", seamless co-op;\nRecyclepen\n\nTabetha'
    );
    expect(parsed).toEqual([
      'apivault.tech',
      'seamless co-op',
      'Recyclepen',
      'Tabetha',
    ]);
  });
});

describe('Multi-Provider Engine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates all 7 default providers with latest non-deprecated November 2026 models', () => {
    const providers = createDefaultProviders();
    expect(Object.keys(providers)).toHaveLength(7);
    expect(PROVIDER_CATALOG.anthropic.supportsStt).toBe(false);
    expect(PROVIDER_CATALOG.deepgram.supportsLlm).toBe(false);
    expect(PROVIDER_CATALOG.gemini.supportsDirectAudioLlm).toBe(true);

    expect(providers.openai.sttModel).toBe('gpt-transcribe');
    expect(providers.openai.llmModel).toBe('gpt-6-luna');
    expect(providers.groq.sttModel).toBe('whisper-large-v3-turbo');
    expect(providers.groq.llmModel).toBe('openai/gpt-oss-20b');
    expect(providers.gemini.sttModel).toBe('gemini-3.5-flash-lite');
    expect(providers.gemini.llmModel).toBe('gemini-3.8-flash');
    expect(providers.anthropic.llmModel).toBe('claude-haiku-5-5');
    expect(providers.deepgram.sttModel).toBe('nova-3');
    expect(providers.elevenlabs.sttModel).toBe('scribe_v3');
    expect(providers.custom.llmModel).toBe('openrouter/free');
  });

  it('auto-upgrades deprecated persisted model IDs while keeping user API keys', () => {
    const defaults = createDefaultProviders();
    const migrated = sanitizeLoadedState({
      providers: {
        ...defaults,
        openai: { ...defaults.openai, apiKey: 'sk-keep-me', sttModel: 'whisper-1', llmModel: 'gpt-4o-mini' },
        groq: { ...defaults.groq, apiKey: 'gsk-keep-me', llmModel: 'llama-3.3-70b-versatile' },
        gemini: { ...defaults.gemini, apiKey: 'AIza-keep-me', sttModel: 'gemini-2.5-flash', llmModel: 'gemini-2.5-pro' },
        anthropic: { ...defaults.anthropic, apiKey: 'sk-ant-keep', llmModel: 'claude-3-5-haiku-latest' },
        elevenlabs: { ...defaults.elevenlabs, apiKey: 'el-keep', sttModel: 'scribe_v1' },
      },
    });

    expect(migrated.providers.openai.apiKey).toBe('sk-keep-me');
    expect(migrated.providers.openai.sttModel).toBe('gpt-transcribe');
    expect(migrated.providers.openai.llmModel).toBe('gpt-6-luna');
    expect(migrated.providers.groq.apiKey).toBe('gsk-keep-me');
    expect(migrated.providers.groq.llmModel).toBe('openai/gpt-oss-20b');
    expect(migrated.providers.gemini.apiKey).toBe('AIza-keep-me');
    expect(migrated.providers.gemini.sttModel).toBe('gemini-3.5-flash-lite');
    expect(migrated.providers.gemini.llmModel).toBe('gemini-3.8-flash');
    expect(migrated.providers.anthropic.llmModel).toBe('claude-haiku-5-5');
    expect(migrated.providers.elevenlabs.sttModel).toBe('scribe_v3');
  });

  it('validates missing API key without issuing network calls', async () => {
    const providers = createDefaultProviders();
    const res = await testProviderConnection(providers.openai);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/API key is required/i);
  });

  it('discovers compatible Groq models from the verification response without a second request', async () => {
    const provider = { ...createDefaultProviders().groq, apiKey: 'test-key' };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: 'whisper-large-v3-turbo', active: true },
        { id: 'llama-new-chat', active: true },
        { id: 'llama-retired', active: false },
        { id: 'canopylabs/orpheus-tts', active: true },
        { id: 'llama-new-chat', active: true },
      ],
    })));
    vi.stubGlobal('fetch', fetchMock);

    expect(await testProviderConnection(provider)).toMatchObject({
      ok: true,
      models: {
        speech: [{ id: 'whisper-large-v3-turbo', label: 'whisper-large-v3-turbo' }],
        ai: [{ id: 'llama-new-chat', label: 'llama-new-chat' }],
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('loads later Gemini catalog pages and ignores models without generateContent', async () => {
    const provider = { ...createDefaultProviders().gemini, apiKey: 'test-key' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        nextPageToken: 'next+/=',
        models: [{ name: 'models/gemini-live', supportedGenerationMethods: ['bidiGenerateContent'] }],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        models: [{ name: 'models/gemini-new-flash', displayName: 'Gemini New Flash', supportedGenerationMethods: ['generateContent'] }],
      })));
    vi.stubGlobal('fetch', fetchMock);
    const expected = [{ id: 'gemini-new-flash', label: 'Gemini New Flash' }];

    expect(await testProviderConnection(provider)).toMatchObject({ ok: true, models: { speech: expected, ai: expected } });
    expect(fetchMock.mock.calls[1][0]).toContain('pageToken=next%2B%2F%3D');
  });

  it('checks Deepgram credentials before reading the public catalog and offers batch speech models', async () => {
    const provider = { ...createDefaultProviders().deepgram, apiKey: 'test-key' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"projects":[]}'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        stt: [
          { canonical_name: 'nova-new', batch: true },
          { canonical_name: 'flux-streaming', batch: false },
        ],
        tts: [{ canonical_name: 'aura-example' }],
      })));
    vi.stubGlobal('fetch', fetchMock);

    expect(await testProviderConnection(provider)).toMatchObject({
      ok: true,
      models: { speech: [{ id: 'nova-new', label: 'nova-new' }], ai: [] },
    });
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/projects$/);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Token test-key' });
    expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty('Authorization');
  });

  it('lists built-in ElevenLabs speech models because /models only returns text-to-speech models', async () => {
    vi.stubGlobal('window', undefined);
    const provider = { ...createDefaultProviders().elevenlabs, apiKey: 'el-key' };
    const speech = PROVIDER_CATALOG.elevenlabs.sttModels;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{ model_id: 'eleven_v3', name: 'Eleven v3', can_do_text_to_speech: true }]),
    }));
    expect(await listProviderModels(provider)).toMatchObject({ ok: true, models: { speech, ai: [] } });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ detail: { status: 'missing_permissions' } }),
    }));
    expect(await listProviderModels(provider)).toMatchObject({ ok: true, models: { speech, ai: [] } });
  });

  it('calls Groq OpenAI-compatible transcription endpoint with dictionary hints', async () => {
    const providers = createDefaultProviders();
    providers.groq.apiKey = 'gsk_test_123';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ text: 'Hello Yap Yap' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
    const text = await transcribeAudio(audio, providers.groq, {
      dictionaryWords: ['Yap Yap', 'apivault.tech'],
    });

    expect(text).toBe('Hello Yap Yap');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(init.headers.Authorization).toBe('Bearer gsk_test_123');
  });

  it('routes multipart STT uploads through Electron IPC with ElevenLabs scribe_v3 default', async () => {
    const providers = createDefaultProviders();
    providers.elevenlabs.apiKey = 'el_test_key';

    const apiMultipartMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: JSON.stringify({ text: 'Transcribed via Electron IPC' }),
    });
    vi.stubGlobal('window', {
      yapyap: {
        apiMultipart: apiMultipartMock,
      },
    });

    const audio = new Blob([new Uint8Array([10, 20, 30])], { type: 'audio/webm' });
    const text = await transcribeAudio(audio, providers.elevenlabs);

    expect(text).toBe('Transcribed via Electron IPC');
    expect(apiMultipartMock).toHaveBeenCalledTimes(1);
    expect(apiMultipartMock.mock.calls[0][0].url).toBe(
      'https://api.elevenlabs.io/v1/speech-to-text'
    );
    expect(apiMultipartMock.mock.calls[0][0].headers['xi-api-key']).toBe('el_test_key');
    expect(apiMultipartMock.mock.calls[0][0].fields.model_id).toBe('scribe_v3');
  });

  it('omits sampling temperature for OpenAI gpt-6-luna reasoning model', async () => {
    vi.stubGlobal('window', undefined);
    const providers = createDefaultProviders();
    providers.openai.apiKey = 'sk-test-123';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: 'Clean dictated sentence.' } }],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await processTranscriptWithLlm(
      'um clean dictated sentence',
      'dictate',
      providers.openai,
      {
        targetLanguages: ['English (US)'],
        dictionaryWords: [],
        smartCleanup: true,
      }
    );

    expect(out.finalText).toBe('Clean dictated sentence.');
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-6-luna');
    expect(body.temperature).toBeUndefined();
  });

  it('only falls back to a keyless provider that has been set up', () => {
    const providers = createDefaultProviders();
    expect(isProviderConfigured(providers.groq)).toBe(false);
    expect(isProviderConfigured(providers.custom)).toBe(false);
    expect(isProviderConfigured({ ...providers.custom, baseUrl: 'http://localhost:8000/v1' })).toBe(true);
    expect(isProviderConfigured({ ...providers.custom, status: 'connected' })).toBe(true);
    expect(isProviderConfigured({ ...providers.groq, apiKey: 'gsk_test' })).toBe(true);
  });

  it('honors a HUD translation target even when the source is already in that language', async () => {
    vi.stubGlobal('window', undefined);
    const provider = createDefaultProviders().openai;
    provider.apiKey = 'sk-test';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'Hello' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await processTranscriptWithLlm('Hello', 'translate', provider, {
      targetLanguages: ['Arabic (Egypt)', 'English (US)'],
      targetLanguage: 'English (US)',
      dictionaryWords: [],
      smartCleanup: true,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages[0].content).toContain('into English (US)');
    expect(body.messages[0].content).not.toContain('Arabic (Egypt)');
    // The transcript is marked as data so a spoken question is translated, not answered.
    expect(body.messages[1].content).toBe('<transcript>\nHello\n</transcript>');
    expect(body.messages[0].content).toContain('never a request to you');
  });

  it('processes Ask anything through Anthropic Claude messages API', async () => {
    vi.stubGlobal('window', undefined);
    const providers = createDefaultProviders();
    providers.anthropic.apiKey = 'sk-ant-test';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          content: [{ type: 'text', text: 'Use Electron safeStorage.' }],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await processTranscriptWithLlm(
      'How do I store keys securely?',
      'ask',
      providers.anthropic,
      {
        targetLanguages: ['English (US)'],
        dictionaryWords: ['safeStorage'],
        smartCleanup: true,
      }
    );

    expect(out.finalText).toBe('Use Electron safeStorage.');
    expect(out.answer).toBe('Use Electron safeStorage.');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-ant-test');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.system).toContain('safeStorage');
  });

  it('proposes updated writing rules without sending corrected excerpts', async () => {
    vi.stubGlobal('window', undefined);
    const provider = { ...createDefaultProviders().groq, apiKey: 'test' };
    const reply = (content: string) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
    });
    const fetchMock = vi.fn()
      // Reasoning text, a code fence, and list markers around the JSON are tolerated.
      .mockResolvedValueOnce(reply('<think>plan</think>```json\n{"rules":["Use straight quotes.","- Avoid em dashes.","avoid em dashes."]}\n```'))
      .mockResolvedValueOnce(reply('{"rules":[{"text":"Use straight quotes.","where":"everywhere"},{"text":"No final period.","where":"messaging"}]}'))
      .mockResolvedValueOnce(reply('{"rules":[]}'))
      .mockResolvedValueOnce(reply('{"rules":null}'))
      .mockResolvedValueOnce(reply('Sure, done!'))
      .mockResolvedValueOnce(reply(JSON.stringify({ rules: Array.from({ length: 21 }, (_, index) => `Rule ${index}.`) })))
      // Only learned categories can be corrected, an unknown tone keeps the learned one,
      // and a style returned unchanged is not a correction.
      .mockResolvedValueOnce(reply(JSON.stringify({
        rules: ['Use straight quotes.'],
        styles: [
          { category: 'Messaging', tone: 'Grumpy', phrasing: 'Standard capitalization, concise, standard punctuation' },
          { category: 'Email', tone: 'Formal', phrasing: 'Sentence case.' },
          { category: 'Spreadsheets', tone: 'Neutral', phrasing: 'No punctuation' },
        ],
      })));
    vi.stubGlobal('fetch', fetchMock);
    const profiles = [{
      category: 'Email', tone: 'Formal', phrasing: 'Sentence case',
      count: 3, corrections: 1, examples: ['Private client email'],
    }, {
      category: 'Messaging', tone: 'Neutral', phrasing: 'Standard capitalization, concise, no punctuation',
      count: 5, corrections: 0, examples: [],
    }];
    const current = { rules: ['Use straight quotes.'], profiles };
    const rulesOnly = (rules: string[]) => ({ rules, styles: {} });

    await expect(proposeWritingPreferences(provider, current, 'Avoid em dashes'))
      .resolves.toEqual(rulesOnly(['Use straight quotes.', 'Avoid em dashes.']));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(JSON.parse(body.messages[1].content)).toEqual({
      rules: [{ text: 'Use straight quotes.', where: 'everywhere' }],
      learnedStyles: [
        { category: 'Email', tone: 'Formal', phrasing: 'Sentence case' },
        { category: 'Messaging', tone: 'Neutral', phrasing: 'Standard capitalization, concise, no punctuation' },
      ],
      request: 'Avoid em dashes',
    });
    await expect(proposeWritingPreferences(provider, current, 'No period in chats'))
      .resolves.toEqual(rulesOnly(['Use straight quotes.', '[Messaging] No final period.']));
    await expect(proposeWritingPreferences(provider, current, 'Remove everything')).resolves.toEqual(rulesOnly([]));
    await expect(proposeWritingPreferences(provider, current, 'Translate to French')).rejects.toThrow('not something a writing rule can do');
    await expect(proposeWritingPreferences(provider, current, 'Avoid em dashes')).rejects.toThrow('could not be read');
    await expect(proposeWritingPreferences(provider, current, 'Add many')).rejects.toThrow('limit of 20 rules');
    await expect(proposeWritingPreferences(provider, current, 'I need punctuation back in messages')).resolves.toEqual({
      rules: ['Use straight quotes.'],
      styles: { Messaging: { tone: 'Neutral', phrasing: 'Standard capitalization, concise, standard punctuation' } },
    });
  });

  it('joins learned phrasings without stray periods', () => {
    const [profile] = buildWritingProfiles([
      { mode: 'dictate', writingSample: { category: 'Email', tone: 'Formal', phrasing: 'Sentence case, no exclamation points.' } },
      { mode: 'dictate', writingSample: { category: 'Email', tone: 'Formal', phrasing: 'Full punctuation' } },
      { mode: 'dictate', writingSample: { category: 'Email', tone: 'Formal', phrasing: 'Sentence case, no exclamation points' } },
    ]);
    expect(profile.phrasing).toBe('Sentence case, no exclamation points; Full punctuation');
  });

  it('applies saved corrections over learned styles until they are reset', () => {
    const learned = buildWritingProfiles([
      { mode: 'dictate', writingSample: { category: 'Messaging', tone: 'Casual', phrasing: 'no punctuation' } },
      { mode: 'dictate', writingSample: { category: 'Email', tone: 'Formal', phrasing: 'Sentence case' } },
    ]);
    const corrections = parseStyleCorrections({
      messaging: { tone: 'Casual', phrasing: 'Standard punctuation' },
      Nowhere: { tone: 'Casual', phrasing: 'x' },
      Email: 'broken',
    });
    expect(corrections).toEqual({ Messaging: { tone: 'Casual', phrasing: 'Standard punctuation' } });
    const applied = applyStyleCorrections(learned, corrections);
    expect(applied.find((p) => p.category === 'Messaging')).toMatchObject({ phrasing: 'Standard punctuation', corrected: true, count: 1 });
    expect(applied.find((p) => p.category === 'Email')).not.toHaveProperty('corrected');
    expect(applyStyleCorrections(learned, {})).toEqual(learned);
    const saved = getInitialState();
    expect(sanitizeLoadedState({ ...saved, settings: { ...saved.settings, styleCorrections: 'bad' as never } }).settings.styleCorrections).toEqual({});
  });

  it('keeps saved writing rules clean, unique, and within limits', () => {
    expect(parseWritingPreferences(' Use straight quotes. \n\n1. Avoid  em dashes.\nuse straight quotes.')).toEqual(['Use straight quotes.', 'Avoid em dashes.']);
    expect(parseWritingPreferences(Array.from({ length: 30 }, (_, index) => `Rule ${index}`))).toHaveLength(20);
    expect(parseWritingPreferences(undefined)).toEqual([]);
    // A rule can be limited to one kind of place. An unknown place name is kept as plain text.
    const scoped = '[messaging] No final period.\nWrite numbers as digits.\n[Nowhere] Odd rule.';
    expect(parseWritingPreferences(scoped)).toEqual(['[Messaging] No final period.', 'Write numbers as digits.', '[Nowhere] Odd rule.']);
    expect(writingRulesFor(scoped, 'Messaging')).toEqual(['No final period.', 'Write numbers as digits.', '[Nowhere] Odd rule.']);
    expect(writingRulesFor(scoped, 'Email')).toEqual(['Write numbers as digits.', '[Nowhere] Odd rule.']);
    expect(writingRulesFor(scoped, undefined)).toEqual(['Write numbers as digits.', '[Nowhere] Odd rule.']);
    const saved = getInitialState();
    const restored = sanitizeLoadedState({ ...saved, settings: { ...saved.settings, writingPreferences: 42 as unknown as string } });
    expect(restored.settings.writingPreferences).toBe('');
  });

  it('loads saved personalization preferences and applies them only to dictation cleanup', async () => {
    vi.stubGlobal('window', undefined);
    const provider = { ...createDefaultProviders().groq, apiKey: 'test' };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'Clean text.' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const saved = getInitialState();
    const preferences = 'Avoid em dashes.';
    const restored = sanitizeLoadedState({ ...saved, settings: { ...saved.settings, writingPreferences: preferences } });
    expect(restored.settings.writingPreferences).toBe(preferences);
    expect(saved.settings.writingPreferences).toBe('');
    const options = {
      targetLanguages: [], dictionaryWords: [], smartCleanup: true,
      writingPreferences: restored.settings.writingPreferences,
    };

    await processTranscriptWithLlm('Clean text', 'dictate', provider, options);
    await processTranscriptWithLlm('Clean text', 'translate', provider, options);
    const [dictation, translation] = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).messages[0].content);
    expect(dictation).toContain(preferences);
    expect(translation).not.toContain(preferences);
  });

  it('sends a rule saved for one kind of place only when the dictation is going there', async () => {
    vi.stubGlobal('window', undefined);
    const provider = { ...createDefaultProviders().groq, apiKey: 'test' };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'Clean text.' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const options = {
      targetLanguages: [], dictionaryWords: [], smartCleanup: true,
      writingPreferences: '[Messaging] Leave out the final period.\nWrite numbers as digits.',
    };
    const gmail = { application: 'Google Chrome', domain: 'mail.google.com' };

    await processTranscriptWithLlm('Clean text', 'dictate', provider, { ...options, destination: gmail });
    await processTranscriptWithLlm('Clean text', 'dictate', provider, { ...options, destination: { application: 'Slack' } });
    await processTranscriptWithLlm('Clean text', 'dictate', provider, options);
    // A category the app already knows wins over what the destination suggests.
    await processTranscriptWithLlm('Clean text', 'dictate', provider, { ...options, destination: gmail, destinationCategory: 'Messaging' });
    const [email, chat, unknown, known] = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).messages[0].content);
    for (const prompt of [email, chat, unknown, known]) expect(prompt).toContain('Write numbers as digits.');
    expect(email).not.toContain('Leave out the final period.');
    expect(unknown).not.toContain('Leave out the final period.');
    expect(chat).toContain('Leave out the final period.');
    expect(known).toContain('Leave out the final period.');
    // The place label is the app's business, not the model's.
    expect(chat).not.toContain('[Messaging]');
  });

  it('detects a category and supplies its learned style to dictation cleanup', async () => {
    vi.stubGlobal('window', undefined);
    const provider = { ...createDefaultProviders().groq, apiKey: 'test' };
    const response = (content: string) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response('```json\n{"category":"email","tone":"Neutral","phrasing":"Short sentences"}\n```'))
      .mockResolvedValueOnce(response('Inspection complete.'))
      .mockResolvedValueOnce(response('invalid JSON'));
    vi.stubGlobal('fetch', fetchMock);
    const profile = { category: 'Email', tone: 'Direct', phrasing: 'Short sentences', count: 3, corrections: 1, examples: ['Thanks, Sam.'] };
    const destination = { application: 'Chrome', domain: 'mail.google.com', textBefore: 'Hi Sam,' };
    const detected = await detectWritingStyle('Inspection complete', provider, {
      destination: { application: destination.application, domain: destination.domain },
    });
    expect(detected?.category).toBe('Email');
    await processTranscriptWithLlm('Inspection complete', 'dictate', provider, {
      targetLanguages: [], dictionaryWords: [], smartCleanup: true, writingStyles: [profile], destination,
    });
    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(body.messages[0].content).toContain('"tone":"Direct"');
    expect(body.messages[0].content).toContain('Thanks, Sam.');
    expect(body.messages[0].content).toContain('Hi Sam,');
    const classification = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(JSON.parse(classification.messages[1].content).destination).toEqual({ application: 'Chrome', domain: 'mail.google.com' });
    expect(await detectWritingStyle('Inspection complete', provider)).toBeUndefined();
  });
});

it('keeps only the browser domain and rejects addresses containing credentials', () => {
  expect(browserDomain('https://mail.google.com/mail/u/0/?q=private#inbox')).toBe('mail.google.com');
  expect(browserDomain('docs.google.com/document/d/123')).toBe('docs.google.com');
  expect(browserDomain('https://user:secret@example.com')).toBeUndefined();
  expect(browserDomain('file:///C:/private.txt')).toBeUndefined();
});
it('resolves the writing category from the destination without a model call', () => {
  expect(categoryForDestination({ application: 'Google Chrome', domain: 'mail.google.com' })).toBe('Email');
  expect(categoryForDestination({ application: 'Google Chrome', domain: 'www.linkedin.com' })).toBe('Social platforms');
  expect(categoryForDestination({ application: 'Google Chrome', domain: 'example.com' })).toBeUndefined();
  expect(categoryForDestination({ application: 'Visual Studio Code' })).toBe('Development tools');
  expect(categoryForDestination({ application: 'Slack' })).toBe('Messaging');
  expect(categoryForDestination()).toBeUndefined();
});
it('keeps categories to the fixed set and lets hand corrections lead the profile', () => {
  expect(parseWritingSample({ category: 'Field reports', tone: 'Neutral', phrasing: 'Detailed' })).toBeUndefined();
  const email = parseWritingSample({ category: 'Email', tone: 'Friendly', phrasing: 'Concise' });
  const corrected = parseWritingSample({ category: 'email', tone: 'Formal', phrasing: 'Full sentences' });
  const messaging = parseWritingSample({ category: 'Messaging', tone: 'Casual', phrasing: 'Lowercase' });
  const profiles = buildWritingProfiles([
    { mode: 'dictate', writingSample: email },
    { mode: 'dictate', writingSample: email },
    { mode: 'dictate', writingSample: corrected, writingCorrection: true, text: 'Dear Sam, thank you.' },
    { mode: 'dictate', writingSample: messaging },
    { mode: 'ask', writingSample: messaging },
  ]);
  expect(profiles).toEqual([
    { category: 'Email', tone: 'Formal', phrasing: 'Full sentences', count: 3, corrections: 1, examples: ['Dear Sam, thank you.'] },
    { category: 'Messaging', tone: 'Casual', phrasing: 'Lowercase', count: 1, corrections: 0, examples: [] },
  ]);
  expect(personalizationScore(profiles[0])).toBeGreaterThan(personalizationScore(profiles[1]));
  expect(personalizationScore({ count: 1000, corrections: 0 })).toBeLessThan(100);
});
it('continues the text at the caret with matching spacing and capitalization', () => {
  expect(fitToSurroundingText('Sounds good.', undefined)).toBe('Sounds good.');
  expect(fitToSurroundingText('Sounds good.', 'Hi Sam,\n')).toBe('Sounds good.');
  expect(fitToSurroundingText('Sounds good.', 'Thanks for the update.')).toBe(' Sounds good.');
  expect(fitToSurroundingText('And then we ship.', 'We test it first,')).toBe(' and then we ship.');
  expect(fitToSurroundingText('And then we ship.', 'We test it first, ')).toBe('and then we ship.');
  expect(fitToSurroundingText("I'll review it.", 'By friday ')).toBe("I'll review it.");
  expect(fitToSurroundingText('API keys are set.', 'the ')).toBe('API keys are set.');
  expect(fitToSurroundingText('Supabase handles auth.', 'because ', ['Supabase'])).toBe('Supabase handles auth.');
  expect(fitToSurroundingText('Alex agreed.', 'I asked Alex and ')).toBe('Alex agreed.');
});
it('remembers the category the model chose for an unrecognized destination', () => {
  const sample = (category: string) => ({ category, tone: 'Neutral', phrasing: 'Short' });
  expect(destinationKey({ application: 'Google Chrome', domain: 'www.Example.com' })).toBe('example.com');
  expect(destinationKey({ application: 'Obscure App' })).toBe('obscure app');
  const learned = buildSourceCategories([
    { writingSource: 'example.com', writingSample: sample('Project management') },
    { writingSource: 'example.com', writingSample: sample('Project management') },
    { writingSource: 'example.com', writingSample: sample('Email') },
    { writingSample: sample('Email') },
  ]);
  expect([...learned]).toEqual([['example.com', 'Project management']]);
});
describe('Corrections made in the destination after a paste', () => {
  const pasted = 'We moved auth to super base and the edge functions run on versel now.';
  const field = (text: string) => `Hi team,\n${text}\nThanks`;

  it('learns respelled words and ignores everything around the pasted text', () => {
    expect(extractCorrections(pasted, field(pasted), field(pasted))).toEqual([]);
    expect(extractCorrections(pasted, field(pasted),
      'Hello team,\nWe moved auth to Supabase and the edge functions run on Vercel now.\nThanks a lot'.replace('Hello', 'Hi'),
    )).toEqual(['Supabase', 'Vercel']);
    expect(extractCorrections('push it to github today', 'push it to github today', 'push it to GitHub today')).toEqual(['GitHub']);
    expect(extractCorrections('the build passed', 'the build passed', 'The build passed')).toEqual([]);
    // Joining a split word is learned even though only the space changed.
    expect(extractCorrections('check its end point today', 'check its end point today', 'check its endpoint today')).toEqual(['endpoint']);
    expect(extractCorrections(pasted, pasted, `${pasted} One more thing about billing.`)).toEqual([]);
  });

  it('learns nothing from rewrites, deletions, or text it cannot locate', () => {
    expect(extractCorrections(pasted, field(pasted), field('Auth lives in a hosted database and functions are deployed elsewhere.'))).toEqual([]);
    expect(extractCorrections(pasted, field(pasted), field('We moved auth and the edge functions run now.'))).toEqual([]);
    expect(extractCorrections('see you tomorrow', 'see you tomorrow', 'see you today')).toEqual([]);
    expect(extractCorrections(pasted, field(pasted), '')).toBeUndefined();
    expect(extractCorrections(pasted, 'unrelated', 'unrelated')).toBeUndefined();
  });

  it('keeps the last settled correction when the field is cleared or focus moves', async () => {
    const fixed = pasted.replace('super base', 'Supabase');
    const reads = [pasted, pasted.replace('super base', 'Supab'), fixed, fixed, ''].map((text) => ({ field: 'a', text }));
    const read = vi.fn(async () => reads.shift() ?? { field: 'b', text: '' });
    const options = { settleMs: 0, intervalMs: 0, windowMs: 1000 };
    expect(await watchPasteCorrections(pasted, read, options)).toEqual(['Supabase']);
    expect(await watchPasteCorrections(pasted, async () => ({ field: 'a', text: 'something else' }), options)).toEqual([]);
    expect(await watchPasteCorrections(pasted, async () => undefined, options)).toEqual([]);
  });
});
