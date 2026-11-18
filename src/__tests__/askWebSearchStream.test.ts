import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultProviders } from '../services/providers/catalog';
import { processTranscriptWithLlm } from '../services/providers/engine';
import type { ProviderConfig, ProviderId } from '../types/app';

const options = { targetLanguages: [], dictionaryWords: [], smartCleanup: true };
const provider = (id: ProviderId, changes: Partial<ProviderConfig> = {}) => ({ ...createDefaultProviders()[id], apiKey: 'key', ...changes });

/** A streamed reply sent in the given pieces; `onPiece` runs as each one is read. */
function streamed(pieces: string[], onPiece?: (index: number) => void) {
  let index = 0;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= pieces.length) return controller.close();
      onPiece?.(index);
      controller.enqueue(encoder.encode(pieces[index++]));
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}
const sse = (events: unknown[]) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`);

beforeEach(() => vi.stubGlobal('window', undefined));

describe('Ask anything streams its answer to show a search as it happens', () => {
  it('Claude: signals the search when it starts and rebuilds the answer', async () => {
    const order: string[] = [];
    const pieces = sse([
      { type: 'message_start', message: {} },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me check.' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', id: 's1', name: 'web_search', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":"btc"}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'content_block_start', index: 2, content_block: { type: 'web_search_tool_result', tool_use_id: 's1', content: [] } },
      { type: 'content_block_start', index: 3, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: 'Bitcoin is ' } },
      { type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: '$64,000.' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    ]);
    const fetchMock = vi.fn().mockResolvedValue(streamed(pieces, (i) => order.push(`piece ${i}`)));
    vi.stubGlobal('fetch', fetchMock);

    const out = await processTranscriptWithLlm('Bitcoin price?', 'ask', provider('anthropic'), {
      ...options,
      onWebSearch: () => order.push('searching'),
    });

    expect(out).toEqual({ finalText: 'Bitcoin is $64,000.', answer: 'Bitcoin is $64,000.', searchedWeb: true });
    // The signal comes with the piece that starts the search, before the answer text arrives.
    expect(order.indexOf('searching')).toBeGreaterThan(order.indexOf('piece 3'));
    expect(order.indexOf('searching')).toBeLessThan(order.indexOf('piece 8'));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).stream).toBe(true);
  });

  it('Claude: sends a paused turn back with the blocks rebuilt from the stream', async () => {
    const paused = sse([
      { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 's1', name: 'web_search', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"news"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'pause_turn' } },
    ]);
    const done = sse([
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done.' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    ]);
    const fetchMock = vi.fn().mockResolvedValueOnce(streamed(paused)).mockResolvedValueOnce(streamed(done));
    vi.stubGlobal('fetch', fetchMock);

    const out = await processTranscriptWithLlm('News?', 'ask', provider('anthropic'), options);

    expect(out.answer).toBe('Done.');
    const resent = JSON.parse(fetchMock.mock.calls[1][1].body as string).messages[1];
    expect(resent).toEqual({ role: 'assistant', content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'news' } }] });
  });

  it('OpenAI: signals the search and reads the finished response', async () => {
    const onWebSearch = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamed(sse([
      { type: 'response.created', response: {} },
      { type: 'response.web_search_call.in_progress', item_id: 'w1' },
      { type: 'response.output_text.delta', delta: 'It is ' },
      { type: 'response.completed', response: { output: [
        { type: 'web_search_call' },
        { type: 'message', content: [{ type: 'output_text', text: 'It is sunny.' }] },
      ] } },
    ]))));

    const out = await processTranscriptWithLlm('Weather?', 'ask', provider('openai'), { ...options, onWebSearch });

    expect(out).toEqual({ finalText: 'It is sunny.', answer: 'It is sunny.', searchedWeb: true });
    expect(onWebSearch).toHaveBeenCalledTimes(1);
  });

  it('Groq: signals the search from executed tools, even when the marker is split across pieces', async () => {
    const onWebSearch = vi.fn();
    const events = sse([
      { choices: [{ delta: { role: 'assistant', content: '' } }] },
      { choices: [{ delta: { executed_tools: [{ name: 'browser.search', type: 'browser_search' }] } }] },
      { choices: [{ delta: { content: 'BTC is $64k 【1†L1-L2】.' } }] },
    ]);
    const joined = events.join('');
    const cut = joined.indexOf('executed_tools') + 5;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamed([joined.slice(0, cut), joined.slice(cut)])));

    const out = await processTranscriptWithLlm('BTC?', 'ask', provider('groq'), { ...options, onWebSearch });

    expect(out).toEqual({ finalText: 'BTC is $64k.', answer: 'BTC is $64k.', searchedWeb: true });
    expect(onWebSearch).toHaveBeenCalledTimes(1);
  });

  it('OpenRouter: signals the search when its citations arrive', async () => {
    const onWebSearch = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamed([
      ': OPENROUTER PROCESSING\n\n',
      ...sse([
        { choices: [{ delta: { annotations: [{ type: 'url_citation', url_citation: { url: 'https://x' } }] } }] },
        { choices: [{ delta: { content: 'Yes.' } }] },
        { choices: [{ delta: {} }], usage: { cost: 0.007 } },
      ]),
    ])));

    const out = await processTranscriptWithLlm('Open today?', 'ask', provider('custom', { baseUrl: 'https://openrouter.ai/api/v1' }), { ...options, onWebSearch });

    expect(out).toEqual({ finalText: 'Yes.', answer: 'Yes.', searchedWeb: true });
    expect(onWebSearch).toHaveBeenCalledTimes(1);
  });

  it('does not signal a search when the model answers from what it knows', async () => {
    const onWebSearch = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamed(sse([
      { choices: [{ delta: { content: 'Paris.' } }] },
    ]))));

    const out = await processTranscriptWithLlm('Capital of France?', 'ask', provider('groq'), { ...options, onWebSearch });

    expect(out.answer).toBe('Paris.');
    expect(onWebSearch).not.toHaveBeenCalled();
  });

  it('asks again without streaming when the provider refuses to stream, and still searches', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Your organization must be verified to stream this model.', param: 'stream' } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: [
        { type: 'web_search_call' },
        { type: 'message', content: [{ type: 'output_text', text: 'It is sunny.' }] },
      ] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await processTranscriptWithLlm('Weather?', 'ask', provider('openai'), options);

    expect(out).toEqual({ finalText: 'It is sunny.', answer: 'It is sunny.', searchedWeb: true });
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(second.stream).toBeUndefined();
    expect(second.tools).toEqual([{ type: 'web_search' }]);
  });

  it('reports an error that arrives in the middle of a stream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamed(sse([
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
    ]))));

    await expect(processTranscriptWithLlm('Hi?', 'ask', provider('anthropic'), options)).rejects.toThrow('Overloaded');
  });
});
