import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  buildHeatmapWeeks,
  computeInsights,
  countWords,
  filterByRetention,
  formatWordCount,
} from '../services/stats';
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
      model: 'gpt-4o-mini',
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
      model: 'gemini-2.5-flash',
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

  it('creates all 7 default providers with valid catalog entries', () => {
    const providers = createDefaultProviders();
    expect(Object.keys(providers)).toHaveLength(7);
    expect(PROVIDER_CATALOG.anthropic.supportsStt).toBe(false);
    expect(PROVIDER_CATALOG.deepgram.supportsLlm).toBe(false);
    expect(PROVIDER_CATALOG.gemini.supportsDirectAudioLlm).toBe(true);
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

  it('routes multipart STT uploads through Electron IPC when window.yapyap.apiMultipart is present', async () => {
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
    expect(body.system).toContain('Preserve camelCase identifiers.');
    expect(body.system).toContain('safeStorage');
  });
});
