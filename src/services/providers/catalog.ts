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
    tagline: 'Whisper & GPT-4o Transcribe + GPT-4o intelligence',
    supportsStt: true,
    supportsLlm: true,
    requiresKey: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    docsUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-...',
    sttModels: [
      { id: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe (Fast)' },
      { id: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe (Best accuracy)' },
      { id: 'whisper-1', label: 'whisper-1 (Classic)' },
    ],
    llmModels: [
      { id: 'gpt-4o-mini', label: 'gpt-4o-mini' },
      { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
      { id: 'gpt-4o', label: 'gpt-4o' },
    ],
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    tagline: 'Ultra-low-latency Whisper v3 & Llama 3.3 inference',
    supportsStt: true,
    supportsLlm: true,
    requiresKey: true,
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    docsUrl: 'https://console.groq.com/keys',
    keyPlaceholder: 'gsk_...',
    sttModels: [
      { id: 'whisper-large-v3-turbo', label: 'whisper-large-v3-turbo (Fastest)' },
      { id: 'whisper-large-v3', label: 'whisper-large-v3 (Multilingual)' },
    ],
    llmModels: [
      { id: 'llama-3.3-70b-versatile', label: 'llama-3.3-70b-versatile' },
      { id: 'llama-3.1-8b-instant', label: 'llama-3.1-8b-instant' },
      { id: 'qwen-qwq-32b', label: 'qwen-qwq-32b' },
    ],
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    tagline: 'Native multimodal audio transcription, translation & reasoning',
    supportsStt: true,
    supportsLlm: true,
    supportsDirectAudioLlm: true,
    requiresKey: true,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    docsUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AIza...',
    sttModels: [
      { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash (Recommended)' },
      { id: 'gemini-2.0-flash', label: 'gemini-2.0-flash' },
      { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
    ],
    llmModels: [
      { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
      { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
      { id: 'gemini-2.0-flash', label: 'gemini-2.0-flash' },
    ],
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic Claude',
    tagline: 'High-nuance text polishing, translation & Ask anything',
    supportsStt: false,
    supportsLlm: true,
    requiresKey: true,
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-...',
    sttModels: [],
    llmModels: [
      { id: 'claude-3-5-haiku-latest', label: 'claude-3-5-haiku-latest (Fast)' },
      { id: 'claude-3-7-sonnet-latest', label: 'claude-3-7-sonnet-latest' },
    ],
  },
  deepgram: {
    id: 'deepgram',
    name: 'Deepgram',
    tagline: 'Real-time Nova-3 speech recognition with smart formatting',
    supportsStt: true,
    supportsLlm: false,
    requiresKey: true,
    defaultBaseUrl: 'https://api.deepgram.com/v1',
    docsUrl: 'https://console.deepgram.com/',
    keyPlaceholder: 'dg_...',
    sttModels: [
      { id: 'nova-3', label: 'nova-3 (Latest)' },
      { id: 'nova-2', label: 'nova-2' },
    ],
    llmModels: [],
  },
  elevenlabs: {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    tagline: 'Scribe v1 speech-to-text across 99 languages',
    supportsStt: true,
    supportsLlm: false,
    requiresKey: true,
    defaultBaseUrl: 'https://api.elevenlabs.io/v1',
    docsUrl: 'https://elevenlabs.io/app/settings/api-keys',
    keyPlaceholder: 'sk_...',
    sttModels: [{ id: 'scribe_v1', label: 'scribe_v1' }],
    llmModels: [],
  },
  custom: {
    id: 'custom',
    name: 'Custom / OpenAI-Compatible',
    tagline: 'OpenRouter, Together, Ollama, LM Studio, or local Whisper server',
    supportsStt: true,
    supportsLlm: true,
    requiresKey: false,
    defaultBaseUrl: 'http://localhost:11434/v1',
    docsUrl: 'https://openrouter.ai/keys',
    keyPlaceholder: 'Optional API key (sk-or-...)',
    sttModels: [
      { id: 'whisper-1', label: 'whisper-1 / local model' },
      { id: 'Systran/faster-whisper-large-v3', label: 'faster-whisper-large-v3' },
    ],
    llmModels: [
      { id: 'llama3.2', label: 'llama3.2 (or custom ID)' },
      { id: 'openai/gpt-4o-mini', label: 'openai/gpt-4o-mini' },
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
      sttModel: 'gpt-4o-mini-transcribe',
      llmModel: 'gpt-4o-mini',
      status: 'idle',
    },
    groq: {
      id: 'groq',
      name: 'Groq',
      apiKey: '',
      baseUrl: PROVIDER_CATALOG.groq.defaultBaseUrl,
      sttModel: 'whisper-large-v3-turbo',
      llmModel: 'llama-3.3-70b-versatile',
      status: 'idle',
    },
    gemini: {
      id: 'gemini',
      name: 'Google Gemini',
      apiKey: '',
      baseUrl: PROVIDER_CATALOG.gemini.defaultBaseUrl,
      sttModel: 'gemini-2.5-flash',
      llmModel: 'gemini-2.5-flash',
      status: 'idle',
    },
    anthropic: {
      id: 'anthropic',
      name: 'Anthropic Claude',
      apiKey: '',
      baseUrl: PROVIDER_CATALOG.anthropic.defaultBaseUrl,
      sttModel: '',
      llmModel: 'claude-3-5-haiku-latest',
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
      sttModel: 'scribe_v1',
      llmModel: '',
      status: 'idle',
    },
    custom: {
      id: 'custom',
      name: 'Custom / OpenAI-Compatible',
      apiKey: '',
      baseUrl: PROVIDER_CATALOG.custom.defaultBaseUrl,
      sttModel: 'whisper-1',
      llmModel: 'llama3.2',
      status: 'idle',
    },
  };
}
