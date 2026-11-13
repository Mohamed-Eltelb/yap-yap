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
import { createDefaultProviders, PROVIDER_CATALOG } from '../services/providers/catalog';
import {
  processTranscriptWithLlm,
  testProviderConnection,
  transcribeAudio,
} from '../services/providers/engine';
import { parseDictionaryImportText } from '../components/DictionaryView';
import { HistoryItem } from '../types/app';

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
    const stats = computeInsights(items, 8, baseDate);
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

  it('starts with 100% clean zero-fake state and 0% personalization when empty', () => {
    const init = getInitialState();
    expect(init.history).toEqual([]);
    expect(init.dictionary).toEqual([]);
    const emptyStats = computeInsights(init.history, init.dictionary.length, baseDate);
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

  it('processes Ask anything through Anthropic Claude messages API with category instructions', async () => {
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
        category: 'Development tools',
        categoryInstruction: 'Preserve camelCase identifiers.',
      }
    );

    expect(out.finalText).toBe('Use Electron safeStorage.');
    expect(out.answer).toBe('Use Electron safeStorage.');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-ant-test');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.system).toContain('Preserve camelCase identifiers.');
    expect(body.system).toContain('safeStorage');
  });
});
