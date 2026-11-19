import { ProviderConfig, ProviderId } from '../../types/app';

export interface ProviderMeta {
  id: ProviderId;
  name: string;
  tagline: string;
  supportsStt: boolean;
  supportsLlm: boolean;
  supportsDirectAudioLlm?: boolean;
  requiresKey: boolean;
  defaultBaseUrl?: string;
  docsUrl: string;
  sttModels: { id: string; label: string }[];
  llmModels: { id: string; label: string }[];
  keyPlaceholder: string;
}

export const PROVIDER_CATALOG: Record<ProviderId, ProviderMeta> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    tagline: 'Dictation, cleanup, translation, and Ask Anything',
    supportsStt: true,
    supportsLlm: true,
    requiresKey: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    docsUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-...',
    sttModels: [
      { id: 'gpt-transcribe', label: 'gpt-transcribe (Latest · Recommended)' },
      { id: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe (Legacy)' },
    ],
    llmModels: [
      { id: 'gpt-6-luna', label: 'gpt-6-luna (Fast & efficient)' },
      { id: 'gpt-6.1-terra', label: 'gpt-6.1-terra (Fast writing)' },
      { id: 'gpt-6.2-sol', label: 'gpt-6.2-sol (Balanced)' },
      { id: 'gpt-6.2-astra', label: 'gpt-6.2-astra (Flagship reasoning)' },
    ],
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    tagline: 'Fast AI text processing, and speech recognition best for one language',
    supportsStt: true,
    supportsLlm: true,
    requiresKey: true,
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    docsUrl: 'https://console.groq.com/keys',
    keyPlaceholder: 'gsk_...',
    sttModels: [
      { id: 'whisper-large-v3-turbo', label: 'whisper-large-v3-turbo (Fastest)' },
      { id: 'whisper-large-v3', label: 'whisper-large-v3 (More accurate)' },
    ],
    llmModels: [
      { id: 'openai/gpt-oss-20b', label: 'openai/gpt-oss-20b (1000 t/s · Fast)' },
      { id: 'openai/gpt-oss-120b', label: 'openai/gpt-oss-120b (500 t/s · Reasoning)' },
      { id: 'qwen/qwen3.8-27b', label: 'qwen/qwen3.8-27b (Qwen 3.8)' },
    ],
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    tagline: 'Audio transcription, translation, and AI text processing',
    supportsStt: true,
    supportsLlm: true,
    supportsDirectAudioLlm: true,
    requiresKey: true,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    docsUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AIza...',
    sttModels: [
      { id: 'gemini-3.5-flash-lite', label: 'gemini-3.5-flash-lite (Fast · Recommended)' },
      { id: 'gemini-3.8-flash', label: 'gemini-3.8-flash (High accuracy)' },
      { id: 'gemini-3.6-flash', label: 'gemini-3.6-flash' },
      { id: 'gemini-3.5-transcribe', label: 'gemini-3.5-transcribe (Dedicated STT)' },
    ],
    llmModels: [
      { id: 'gemini-3.8-flash', label: 'gemini-3.8-flash (Recommended)' },
      { id: 'gemini-3.5-flash-lite', label: 'gemini-3.5-flash-lite (Fastest)' },
      { id: 'gemini-4-argon', label: 'gemini-4-argon (Gemini 4 Flagship · Paid tier)' },
    ],
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic Claude',
    tagline: 'Text cleanup, translation, and Ask Anything',
    supportsStt: false,
    supportsLlm: true,
    requiresKey: true,
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-...',
    sttModels: [],
    llmModels: [
      { id: 'claude-haiku-5-5', label: 'claude-haiku-5-5 (Fastest)' },
      { id: 'claude-sonnet-5-5', label: 'claude-sonnet-5-5 (Speed & intelligence)' },
      { id: 'claude-opus-5-5', label: 'claude-opus-5-5 (Flagship)' },
      { id: 'claude-fable-5-2', label: 'claude-fable-5-2 (Deep reasoning)' },
    ],
  },
  deepgram: {
    id: 'deepgram',
    name: 'Deepgram',
    tagline: 'Multilingual speech recognition with smart formatting',
    supportsStt: true,
    supportsLlm: false,
    requiresKey: true,
    defaultBaseUrl: 'https://api.deepgram.com/v1',
    docsUrl: 'https://console.deepgram.com/',
    keyPlaceholder: 'dg_...',
    sttModels: [
      { id: 'nova-3', label: 'nova-3 (Latest · Recommended)' },
      { id: 'nova-3-medical', label: 'nova-3-medical (Clinical)' },
      { id: 'nova-2', label: 'nova-2 (More languages)' },
    ],
    llmModels: [],
  },
  elevenlabs: {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    tagline: 'Multilingual speech recognition',
    supportsStt: true,
    supportsLlm: false,
    requiresKey: true,
    defaultBaseUrl: 'https://api.elevenlabs.io/v1',
    docsUrl: 'https://elevenlabs.io/app/settings/api-keys',
    keyPlaceholder: 'sk_...',
    sttModels: [
      { id: 'scribe_v3', label: 'Scribe v3' },
      { id: 'scribe_v2', label: 'Scribe v2' },
      { id: 'scribe_v2_medical', label: 'Scribe v2 Medical (Clinical)' },
    ],
    llmModels: [],
  },
  custom: {
    id: 'custom',
    name: 'Custom / OpenAI-Compatible',
    tagline: 'OpenRouter, Ollama, LM Studio, or local Whisper server',
    supportsStt: true,
    supportsLlm: true,
    requiresKey: false,
    defaultBaseUrl: 'http://localhost:11434/v1',
    docsUrl: 'https://openrouter.ai/keys',
    keyPlaceholder: 'Optional API key (sk-or-...)',
    sttModels: [
      { id: 'gpt-transcribe', label: 'gpt-transcribe / gateway default' },
      { id: 'Systran/faster-whisper-large-v3', label: 'faster-whisper-large-v3 (Local)' },
      { id: 'whisper-1', label: 'whisper-1 (Legacy local compat)' },
    ],
    llmModels: [
      { id: 'openrouter/free', label: 'openrouter/free (Auto free router)' },
      { id: 'nvidia/nemotron-3.5-lightning:free', label: 'nemotron-3.5-lightning:free' },
      { id: 'qwen3', label: 'qwen3 (Ollama local)' },
      { id: 'openai/gpt-6-luna', label: 'openai/gpt-6-luna (OpenRouter)' },
    ],
  },
};

export const PROVIDER_ORDER: ProviderId[] = [
  'groq',
  'openai',
  'gemini',
  'anthropic',
  'deepgram',
  'elevenlabs',
  'custom',
];

export function createDefaultProviders(): Record<ProviderId, ProviderConfig> {
  return {
    openai: {
      id: 'openai',
      name: 'OpenAI',
      apiKey: '',
      baseUrl: PROVIDER_CATALOG.openai.defaultBaseUrl,
      sttModel: 'gpt-transcribe',
      llmModel: 'gpt-6-luna',
      status: 'idle',
    },
    groq: {
      id: 'groq',
      name: 'Groq',
      apiKey: '',
      baseUrl: PROVIDER_CATALOG.groq.defaultBaseUrl,
      sttModel: 'whisper-large-v3-turbo',
      llmModel: 'openai/gpt-oss-20b',
      status: 'idle',
    },
    gemini: {
      id: 'gemini',
      name: 'Google Gemini',
      apiKey: '',
      baseUrl: PROVIDER_CATALOG.gemini.defaultBaseUrl,
      sttModel: 'gemini-3.5-flash-lite',
      llmModel: 'gemini-3.8-flash',
      status: 'idle',
    },
    anthropic: {
      id: 'anthropic',
      name: 'Anthropic Claude',
      apiKey: '',
      baseUrl: PROVIDER_CATALOG.anthropic.defaultBaseUrl,
      sttModel: '',
      llmModel: 'claude-haiku-5-5',
      status: 'idle',
    },
    deepgram: {
      id: 'deepgram',
      name: 'Deepgram',
      apiKey: '',
      baseUrl: PROVIDER_CATALOG.deepgram.defaultBaseUrl,
      sttModel: 'nova-3',
      llmModel: '',
      status: 'idle',
    },
    elevenlabs: {
      id: 'elevenlabs',
      name: 'ElevenLabs',
      apiKey: '',
      baseUrl: PROVIDER_CATALOG.elevenlabs.defaultBaseUrl,
      sttModel: 'scribe_v3',
      llmModel: '',
      status: 'idle',
    },
    custom: {
      id: 'custom',
      name: 'Custom / OpenAI-Compatible',
      apiKey: '',
      baseUrl: PROVIDER_CATALOG.custom.defaultBaseUrl,
      sttModel: 'gpt-transcribe',
      llmModel: 'openrouter/free',
      status: 'idle',
    },
  };
}

/**
 * Whether a provider can be picked automatically when the chosen one has no key.
 * A keyless provider only counts once it has been set up, so a fresh install is
 * asked for a key instead of being pointed at a local server that is not there.
 */
export function isProviderConfigured(provider: ProviderConfig): boolean {
  if (provider.apiKey.trim()) return true;
  const meta = PROVIDER_CATALOG[provider.id];
  if (meta.requiresKey) return false;
  const baseUrl = provider.baseUrl?.trim() || meta.defaultBaseUrl;
  return provider.status === 'connected' || baseUrl !== meta.defaultBaseUrl;
}
