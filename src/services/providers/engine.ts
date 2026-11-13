import type { HudAction } from '../../../electron/hudActions';
import { DictationMode, PersonalizationCategory, ProviderConfig } from '../../types/app';
import { PROVIDER_CATALOG } from './catalog';

export interface HttpResponsePayload {
  ok: boolean;
  status: number;
  text: string;
}

declare global {
  interface Window {
    yapyap?: {
      isElectron: boolean;
      platform: string;
      checkForUpdate: () => Promise<{ message: string; url?: string }>;
      minimizeWindow: () => void;
      maximizeWindow: () => void;
      closeWindow: () => void;
      setLaunchAtLogin: (enabled: boolean) => Promise<void>;
      setSystemMute: (muted: boolean) => Promise<void>;
      updateShortcuts: (shortcuts: {
        dictate: string[][];
        translate: string[][];
        ask: string[][];
      }) => Promise<boolean>;
      setShortcutEditorOpen: (open: boolean) => void;
      preparePaste: () => void;
      pasteText: (text: string) => Promise<boolean>;
      copyText: (text: string) => Promise<void>;
      toggleHud: (show: boolean, state?: unknown) => void;
      hudReady: () => void;
      setHudIgnoreMouse: (ignore: boolean) => void;
      sendHudAction: (action: HudAction) => void;
      onTriggerMode: (cb: (mode: DictationMode) => void) => () => void;
      onHudState: (cb: (state: unknown) => void) => () => void;
      onHudAction: (
        cb: (action: HudAction) => void
      ) => () => void;
      loadStore: () => Promise<Record<string, unknown> | null>;
      saveStore: (data: Record<string, unknown>) => Promise<void>;
      apiRequest: (req: {
        url: string;
        method: string;
        headers: Record<string, string>;
        bodyBase64?: string;
        bodyText?: string;
      }) => Promise<HttpResponsePayload>;
      apiMultipart: (req: {
        url: string;
        headers: Record<string, string>;
        fileBase64: string;
        fileName: string;
        mimeType: string;
        fields: Record<string, string>;
      }) => Promise<HttpResponsePayload>;
    };
  }
}

async function performRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: FormData | Blob | string;
  }
): Promise<HttpResponsePayload> {
  const method = options.method ?? 'GET';
  const headers = { ...(options.headers ?? {}) };

  // In Electron, route JSON / binary requests through main process to avoid CORS issues
  if (
    typeof window !== 'undefined' &&
    window.yapyap?.apiRequest &&
    !(options.body instanceof FormData)
  ) {
    let bodyBase64: string | undefined;
    let bodyText: string | undefined;
    if (options.body instanceof Blob) {
      const buf = await options.body.arrayBuffer();
      bodyBase64 = arrayBufferToBase64(buf);
    } else if (typeof options.body === 'string') {
      bodyText = options.body;
    }
    return window.yapyap.apiRequest({ url, method, headers, bodyBase64, bodyText });
  }

  const res = await fetch(url, {
    method,
    headers,
    body: options.body,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function performMultipartRequest(
  url: string,
  headers: Record<string, string>,
  audioBlob: Blob,
  fileName: string,
  fields: Record<string, string>
): Promise<HttpResponsePayload> {
  const mimeType = audioBlob.type || 'audio/webm';

  if (typeof window !== 'undefined' && window.yapyap?.apiMultipart) {
    const fileBase64 = await blobToBase64(audioBlob);
    return window.yapyap.apiMultipart({
      url,
      headers,
      fileBase64,
      fileName,
      mimeType,
      fields,
    });
  }

  const form = new FormData();
  form.append('file', new File([audioBlob], fileName, { type: mimeType }));
  for (const [k, v] of Object.entries(fields)) {
    form.append(k, v);
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: form,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  return arrayBufferToBase64(buf);
}

function cleanBaseUrl(url: string | undefined, fallback: string): string {
  return (url && url.trim() ? url.trim() : fallback).replace(/\/+$/, '');
}

function extensionFromMime(mime: string): string {
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  return 'webm';
}

export async function testProviderConnection(
  provider: ProviderConfig
): Promise<{ ok: boolean; message: string }> {
  const meta = PROVIDER_CATALOG[provider.id];
  const key = provider.apiKey.trim();

  if (meta.requiresKey && !key) {
    return { ok: false, message: 'API key is required' };
  }

  try {
    if (provider.id === 'openai' || provider.id === 'groq' || provider.id === 'custom') {
      const base = cleanBaseUrl(provider.baseUrl, meta.defaultBaseUrl ?? 'https://api.openai.com/v1');
      const headers: Record<string, string> = {};
      if (key) headers.Authorization = `Bearer ${key}`;
      const res = await performRequest(`${base}/models`, { method: 'GET', headers });
      if (res.ok) return { ok: true, message: 'Connected & verified' };
      return { ok: false, message: extractErrorMessage(res.text, res.status) };
    }

    if (provider.id === 'gemini') {
      const base = cleanBaseUrl(provider.baseUrl, meta.defaultBaseUrl!);
      const res = await performRequest(
        `${base}/models?key=${encodeURIComponent(key)}`,
        { method: 'GET' }
      );
      if (res.ok) return { ok: true, message: 'Gemini API key verified' };
      return { ok: false, message: extractErrorMessage(res.text, res.status) };
    }

    if (provider.id === 'anthropic') {
      const base = cleanBaseUrl(provider.baseUrl, meta.defaultBaseUrl!);
      const res = await performRequest(`${base}/models`, {
        method: 'GET',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      });
      if (res.ok) return { ok: true, message: 'Anthropic key verified' };
      return { ok: false, message: extractErrorMessage(res.text, res.status) };
    }

    if (provider.id === 'deepgram') {
      const base = cleanBaseUrl(provider.baseUrl, meta.defaultBaseUrl!);
      const res = await performRequest(`${base}/projects`, {
        method: 'GET',
        headers: { Authorization: `Token ${key}` },
      });
      if (res.ok) return { ok: true, message: 'Deepgram key verified' };
      return { ok: false, message: extractErrorMessage(res.text, res.status) };
    }

    if (provider.id === 'elevenlabs') {
      const base = cleanBaseUrl(provider.baseUrl, meta.defaultBaseUrl!);
      const res = await performRequest(`${base}/user`, {
        method: 'GET',
        headers: { 'xi-api-key': key },
      });
      if (res.ok || res.text.includes('missing_permissions') || res.text.includes('user_read')) {
        return { ok: true, message: 'ElevenLabs key verified' };
      }
      return { ok: false, message: extractErrorMessage(res.text, res.status) };
    }

    return { ok: false, message: 'Unsupported provider' };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Network error',
    };
  }
}

export async function transcribeAudio(
  audioBlob: Blob,
  provider: ProviderConfig,
  options: {
    dictionaryWords?: string[];
    language?: string;
    languageVariants?: string[];
  } = {}
): Promise<string> {
  const meta = PROVIDER_CATALOG[provider.id];
  const key = provider.apiKey.trim();

  if (!meta.supportsStt) {
    throw new Error(`${provider.name} does not support speech-to-text. Choose a speech provider in Providers.`);
  }
  if (meta.requiresKey && !key) {
    throw new Error(`Missing API key for ${provider.name}. Add your key in Providers & API Keys.`);
  }

  const dictHint = (options.dictionaryWords ?? []).slice(0, 60).join(', ');
  const variantsHint = (options.languageVariants ?? []).join(', ');
  const ext = extensionFromMime(audioBlob.type || 'audio/webm');

  if (provider.id === 'openai' || provider.id === 'groq' || provider.id === 'custom') {
    const base = cleanBaseUrl(provider.baseUrl, meta.defaultBaseUrl ?? 'https://api.openai.com/v1');
    const fields: Record<string, string> = {
      model: provider.sttModel || meta.sttModels[0]?.id || 'gpt-transcribe',
    };
    const promptParts: string[] = [];
    if (variantsHint) promptParts.push(`Preferred languages: ${variantsHint}.`);
    if (dictHint) promptParts.push(`Custom vocabulary and names: ${dictHint}.`);
    if (promptParts.length > 0) {
      fields.prompt = promptParts.join(' ');
    }
    if (options.language && options.language !== 'auto') {
      fields.language = options.language;
    }

    const headers: Record<string, string> = {};
    if (key) headers.Authorization = `Bearer ${key}`;

    const res = await performMultipartRequest(
      `${base}/audio/transcriptions`,
      headers,
      audioBlob,
      `audio.${ext}`,
      fields
    );
    if (!res.ok) {
      throw new Error(extractErrorMessage(res.text, res.status));
    }
    const json = JSON.parse(res.text) as { text?: string };
    return (json.text ?? '').trim();
  }

  if (provider.id === 'deepgram') {
    const base = cleanBaseUrl(provider.baseUrl, meta.defaultBaseUrl!);
    const model = provider.sttModel || 'nova-3';
    const buildParams = (includeTerms: boolean) => {
      const p = new URLSearchParams({
        model,
        smart_format: 'true',
        punctuate: 'true',
      });
      if (includeTerms) {
        const paramName = model.startsWith('nova-3') ? 'keyterm' : 'keywords';
        for (const kw of (options.dictionaryWords ?? []).slice(0, 20)) {
          p.append(paramName, kw);
        }
      }
      return p;
    };

    let res = await performRequest(`${base}/listen?${buildParams(true).toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${key}`,
        'Content-Type': audioBlob.type || 'audio/webm',
      },
      body: audioBlob,
    });
    if (!res.ok && res.status === 400 && (options.dictionaryWords?.length ?? 0) > 0) {
      res = await performRequest(`${base}/listen?${buildParams(false).toString()}`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${key}`,
          'Content-Type': audioBlob.type || 'audio/webm',
        },
        body: audioBlob,
      });
    }
    if (!res.ok) {
      throw new Error(extractErrorMessage(res.text, res.status));
    }
    const json = JSON.parse(res.text) as {
      results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
    };
    return (json.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '').trim();
  }

  if (provider.id === 'elevenlabs') {
    const base = cleanBaseUrl(provider.baseUrl, meta.defaultBaseUrl!);
    const res = await performMultipartRequest(
      `${base}/speech-to-text`,
      { 'xi-api-key': key },
      audioBlob,
      `audio.${ext}`,
      { model_id: provider.sttModel || 'scribe_v3' }
    );
    if (!res.ok) {
      throw new Error(extractErrorMessage(res.text, res.status));
    }
    const json = JSON.parse(res.text) as { text?: string };
    return (json.text ?? '').trim();
  }

  if (provider.id === 'gemini') {
    const base = cleanBaseUrl(provider.baseUrl, meta.defaultBaseUrl!);
    const model = provider.sttModel || 'gemini-3.5-flash-lite';
    const base64Audio = await blobToBase64(audioBlob);
    const mimeType = (audioBlob.type || 'audio/webm').split(';')[0];

    const hints: string[] = [];
    if (variantsHint) hints.push(`Preferred languages/dialects: ${variantsHint}.`);
    if (dictHint) hints.push(`Custom terms/names that may appear: ${dictHint}.`);

    const promptText =
      'Transcribe the spoken audio accurately in its original language(s). Return ONLY the exact transcription with proper punctuation, no commentary.' +
      (hints.length ? ` ${hints.join(' ')}` : '');

    const payload: Record<string, unknown> = {
      contents: [
        {
          parts: [
            { text: promptText },
            { inlineData: { mimeType, data: base64Audio } },
          ],
        },
      ],
    };

    const res = await performRequest(
      `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) {
      throw new Error(extractErrorMessage(res.text, res.status));
    }
    const json = JSON.parse(res.text) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
            audioTranscription?: { text?: string };
          }>;
        };
      }>;
    };
    return (
      json.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? p.audioTranscription?.text ?? '')
        .join('') ?? ''
    ).trim();
  }

  throw new Error(`Transcription not implemented for ${provider.name}`);
}

export async function processTranscriptWithLlm(
  transcript: string,
  mode: DictationMode,
  provider: ProviderConfig,
  options: {
    targetLanguages: string[];
    targetLanguage?: string;
    dictionaryWords: string[];
    smartCleanup: boolean;
    category?: PersonalizationCategory;
    categoryInstruction?: string;
  }
): Promise<{ finalText: string; answer?: string }> {
  if (!transcript.trim()) {
    return { finalText: '' };
  }

  const meta = PROVIDER_CATALOG[provider.id];
  if (!meta.supportsLlm) {
    throw new Error(`${provider.name} does not support text/AI processing.`);
  }
  const key = provider.apiKey.trim();
  if (meta.requiresKey && !key) {
    throw new Error(`Missing API key for ${provider.name}.`);
  }

  const dictClause = options.dictionaryWords.length
    ? `\nPreserve these exact spellings/terms if referenced: ${options.dictionaryWords.slice(0, 60).join(', ')}.`
    : '';
  const styleClause = options.categoryInstruction
    ? `\nContext style (${options.category ?? 'General'}): ${options.categoryInstruction}`
    : '';

  let systemPrompt = '';
  const userPrompt = transcript;

  if (mode === 'dictate') {
    if (!options.smartCleanup) {
      return { finalText: transcript };
    }
    systemPrompt =
      'You are Yap Yap, a precision dictation formatter. Clean up filler words (um, uh, like), fix punctuation, capitalization, and self-corrections while preserving the speaker’s exact meaning, language, and tone. Output ONLY the cleaned text without quotes or explanations.' +
      dictClause +
      styleClause;
  } else if (mode === 'translate') {
    const targets = options.targetLanguages.length ? options.targetLanguages : ['English'];
    const primaryTarget = options.targetLanguage ?? targets[0];
    const fallback = !options.targetLanguage && targets.length > 1
      ? ` If the speech is already in ${primaryTarget}, translate into another configured target language (${targets.slice(1).join(', ')}).`
      : '';
    systemPrompt =
      `You are Yap Yap in Translate mode. Translate the user's dictated speech naturally and accurately into ${primaryTarget}.${fallback} Output ONLY the translated text.` +
      dictClause;
  } else if (mode === 'ask') {
    systemPrompt =
      'You are Yap Yap in Ask Anything mode. The user spoke a question or instruction. Provide a concise, clear, ready-to-paste answer. Avoid unnecessary preamble.' +
      dictClause +
      styleClause;
  }

  const result = await callLlm(provider, systemPrompt, userPrompt);
  if (mode === 'ask') {
    return { finalText: result, answer: result };
  }
  return { finalText: result };
}

function omitsSamplingTemperature(model: string): boolean {
  const lower = model.toLowerCase();
  return (
    lower.startsWith('gpt-6') ||
    lower.startsWith('gpt-5') ||
    /^o[134](-|$)/.test(lower) ||
    lower.includes('/gpt-6') ||
    lower.includes('/gpt-5')
  );
}

async function callLlm(
  provider: ProviderConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const meta = PROVIDER_CATALOG[provider.id];
  const key = provider.apiKey.trim();
  const base = cleanBaseUrl(provider.baseUrl, meta.defaultBaseUrl ?? '');

  if (provider.id === 'openai' || provider.id === 'groq' || provider.id === 'custom') {
    const model = provider.llmModel || meta.llmModels[0]?.id || 'gpt-6-luna';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    const bodyPayload: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    };
    if (!omitsSamplingTemperature(model)) {
      bodyPayload.temperature = 0.2;
    }

    const res = await performRequest(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload),
    });
    if (!res.ok) throw new Error(extractErrorMessage(res.text, res.status));
    const json = JSON.parse(res.text) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return (json.choices?.[0]?.message?.content ?? '').trim();
  }

  if (provider.id === 'anthropic') {
    const res = await performRequest(`${base}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: provider.llmModel || 'claude-haiku-5-5',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) throw new Error(extractErrorMessage(res.text, res.status));
    const json = JSON.parse(res.text) as {
      content?: Array<{ text?: string }>;
    };
    return (json.content?.map((c) => c.text ?? '').join('') ?? '').trim();
  }

  if (provider.id === 'gemini') {
    const model = provider.llmModel || 'gemini-3.8-flash';
    const res = await performRequest(
      `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        }),
      }
    );
    if (!res.ok) throw new Error(extractErrorMessage(res.text, res.status));
    const json = JSON.parse(res.text) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return (json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '').trim();
  }

  throw new Error(`LLM processing not supported for ${provider.name}`);
}

export function extractErrorMessage(bodyText: string, status: number): string {
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { message?: string } | string;
      message?: string;
      detail?: { message?: string } | string;
    };
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
    if (parsed.message) return parsed.message;
    if (typeof parsed.detail === 'string') return parsed.detail;
    if (parsed.detail?.message) return parsed.detail.message;
  } catch {
    // ignore JSON parse failure
  }
  return `HTTP ${status}${bodyText ? `: ${bodyText.slice(0, 140)}` : ''}`;
}
