import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultProviders } from '../services/providers/catalog';
import { processTranscriptWithLlm, webSearchFor } from '../services/providers/engine';
import type { ProviderConfig, ProviderId } from '../types/app';

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
const options = { targetLanguages: [], dictionaryWords: [], smartCleanup: true };
const provider = (id: ProviderId, changes: Partial<ProviderConfig> = {}) => ({ ...createDefaultProviders()[id], apiKey: 'key', ...changes });
const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body as string);

beforeEach(() => vi.stubGlobal('window', undefined));

describe('Ask anything web search', () => {
  it('lets Claude search, keeping only the text after the search', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({
      stop_reason: 'end_turn',
      content: [
        { type: 'text', text: 'Let me look that up.' },
        { type: 'server_tool_use', name: 'web_search', input: { query: 'score' } },
        { type: 'web_search_tool_result', content: [] },
        { type: 'text', text: 'Egypt won 2-1.' },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await processTranscriptWithLlm('Who won last night?', 'ask', provider('anthropic'), options);

    expect(out).toEqual({ finalText: 'Egypt won 2-1.', answer: 'Egypt won 2-1.', searchedWeb: true });
    const body = bodyOf(fetchMock);
    // Haiku takes the basic search tool.
    expect(body.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]);
    expect(body.system).toContain('Search only when');
    expect(body.system).toContain('including current information from the web');
  });

  it('gives newer Claude models the newer search tool, and marks nothing when it did not search', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({ content: [{ type: 'text', text: 'Paris.' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await processTranscriptWithLlm('Capital of France?', 'ask', provider('anthropic', { llmModel: 'claude-opus-5-5' }), options);

    expect(out).toEqual({ finalText: 'Paris.', answer: 'Paris.', searchedWeb: undefined });
    expect(bodyOf(fetchMock).tools[0].type).toBe('web_search_20260209');
  });

  it('continues a Claude turn that paused during a search', async () => {
    const paused = [{ type: 'server_tool_use', name: 'web_search', input: {} }];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply({ stop_reason: 'pause_turn', content: paused }))
      .mockResolvedValueOnce(reply({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await processTranscriptWithLlm('Latest news?', 'ask', provider('anthropic'), options);

    expect(out.answer).toBe('Done.');
    expect(out.searchedWeb).toBe(true);
    expect(bodyOf(fetchMock, 1).messages[1]).toEqual({ role: 'assistant', content: paused });
  });

  it('asks OpenAI through the Responses API with its web search tool', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({
      output: [
        { type: 'reasoning' },
        { type: 'web_search_call', status: 'completed' },
        { type: 'message', content: [{ type: 'output_text', text: 'It is 30°C ([weather.com](https://weather.com)).' }] },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await processTranscriptWithLlm('Weather in Cairo?', 'ask', provider('openai'), options);

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses');
    const body = bodyOf(fetchMock);
    expect(body.tools).toEqual([{ type: 'web_search' }]);
    expect(body.input).toBe('Weather in Cairo?');
    expect(body.instructions).toContain('Ask Anything');
    expect(out).toEqual({ finalText: 'It is 30°C.', answer: 'It is 30°C.', searchedWeb: true });
  });

  it('grounds Gemini answers with Google Search', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({
      candidates: [{
        content: { parts: [{ text: 'thinking', thought: true }, { text: 'Released in May.' }] },
        groundingMetadata: { webSearchQueries: ['release date'] },
      }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await processTranscriptWithLlm('When did it come out?', 'ask', provider('gemini'), options);

    expect(bodyOf(fetchMock).tools).toEqual([{ google_search: {} }]);
    expect(out).toEqual({ finalText: 'Released in May.', answer: 'Released in May.', searchedWeb: true });
  });

  it('uses Groq browser search on GPT-OSS and removes its citation marks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({
      choices: [{ message: { content: 'Bitcoin is at $90,000 【1†L2-L4】.', executed_tools: [{ type: 'browser.search' }] } }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await processTranscriptWithLlm('Bitcoin price?', 'ask', provider('groq'), options);

    expect(bodyOf(fetchMock).tools).toEqual([{ type: 'browser_search' }]);
    expect(out).toEqual({ finalText: 'Bitcoin is at $90,000.', answer: 'Bitcoin is at $90,000.', searchedWeb: true });
  });

  it('sends no search to models and servers that have none', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({ choices: [{ message: { content: 'Hi.' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    await processTranscriptWithLlm('Hello?', 'ask', provider('groq', { llmModel: 'llama-3.3-70b-versatile' }), options);
    await processTranscriptWithLlm('Hello?', 'ask', provider('custom', { baseUrl: 'http://localhost:11434/v1', llmModel: 'qwen3' }), options);

    for (const call of [0, 1]) {
      const body = bodyOf(fetchMock, call);
      expect(body.tools).toBeUndefined();
      expect(body.messages[0].content).not.toContain('search the web');
      expect(body.messages[0].content).not.toContain('from the web');
      expect(body.messages[0].content).toContain('who you are');
    }
  });

  it('lets OpenRouter models decide when to search', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({
      choices: [{ message: { content: 'Yes.', annotations: [{ type: 'url_citation' }] } }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await processTranscriptWithLlm('Is it open today?', 'ask', provider('custom', { baseUrl: 'https://openrouter.ai/api/v1' }), options);

    expect(bodyOf(fetchMock).tools).toEqual([{ type: 'openrouter:web_search' }]);
    expect(out.searchedWeb).toBe(true);
  });

  it('answers without search when the provider rejects it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply({ error: { message: 'web search is not enabled' } }, 400))
      .mockResolvedValueOnce(reply({ content: [{ type: 'text', text: 'Paris.' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await processTranscriptWithLlm('Capital of France?', 'ask', provider('anthropic'), options);

    expect(out.answer).toBe('Paris.');
    expect(out.searchedWeb).toBeUndefined();
    expect(bodyOf(fetchMock, 1).tools).toBeUndefined();
  });

  it('asks again without search when the search reply has no answer', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply({ output: [{ type: 'web_search_call' }] }))
      .mockResolvedValueOnce(reply({ choices: [{ message: { content: 'Paris.' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await processTranscriptWithLlm('Capital of France?', 'ask', provider('openai'), options);

    expect(out.answer).toBe('Paris.');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('counts OpenRouter searches from its usage report, and leaves other spacing alone', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({
      choices: [{ message: { content: 'Il fait 20° ! ([meteo.fr](https://meteo.fr))' } }],
      usage: { server_tool_use_details: { web_search_requests: 1 } },
    })));

    const out = await processTranscriptWithLlm('Quel temps ?', 'ask', provider('custom', { baseUrl: 'https://openrouter.ai/api/v1' }), options);

    expect(out).toEqual({ finalText: 'Il fait 20° !', answer: 'Il fait 20° !', searchedWeb: true });
  });

  it('answers without search when there is no credit for search fees', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply({ error: { message: 'Insufficient credits' } }, 402))
      .mockResolvedValueOnce(reply({ choices: [{ message: { content: 'Paris.' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await processTranscriptWithLlm('Capital of France?', 'ask', provider('custom', { baseUrl: 'https://openrouter.ai/api/v1' }), options);

    expect(out.answer).toBe('Paris.');
    expect(bodyOf(fetchMock, 1).tools).toBeUndefined();
  });

  it('answers without search when the search allowance is used up', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply({ error: { message: 'RESOURCE_EXHAUSTED' } }, 429))
      .mockResolvedValueOnce(reply({ candidates: [{ content: { parts: [{ text: 'Paris.' }] } }] }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await processTranscriptWithLlm('Capital of France?', 'ask', provider('gemini'), options);

    expect(out.answer).toBe('Paris.');
    expect(bodyOf(fetchMock, 1).tools).toBeUndefined();
  });

  it('writes plain spaces and hyphens in answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({
      choices: [{ message: { content: 'Priced at $64,727.20 USD, up‑to‑date.' } }],
    })));

    const out = await processTranscriptWithLlm('Bitcoin?', 'ask', provider('groq'), options);

    expect(out.answer).toBe('Priced at $64,727.20 USD, up-to-date.');
  });

  it('still reports a bad key instead of retrying', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ error: { message: 'invalid x-api-key' } }, 401)));
    await expect(processTranscriptWithLlm('Hi?', 'ask', provider('anthropic'), options)).rejects.toThrow('invalid x-api-key');
  });

  it('keeps search out of Dictate and Translate', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({ content: [{ type: 'text', text: 'Hello.' }] }));
    vi.stubGlobal('fetch', fetchMock);
    await processTranscriptWithLlm('hello', 'dictate', provider('anthropic'), options);
    expect(bodyOf(fetchMock).tools).toBeUndefined();
  });

  it('knows which providers can search', () => {
    expect(webSearchFor(provider('deepgram'))).toBeUndefined();
    expect(webSearchFor(provider('custom', { baseUrl: 'https://notopenrouter.ai/v1' }))).toBeUndefined();
    expect(webSearchFor(provider('groq', { llmModel: 'openai/gpt-oss-120b' }))).toBe('groq');
  });
});
