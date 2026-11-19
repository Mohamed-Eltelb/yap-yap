import type { ProviderId, ProviderModels } from '../../types/app';

interface CatalogModel {
  id?: string;
  name?: string;
  displayName?: string;
  display_name?: string;
  canonical_name?: string;
  model_id?: string;
  active?: boolean;
  batch?: boolean;
  lifecycle?: string;
  can_do_speech_to_text?: boolean;
  supportedGenerationMethods?: string[];
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
}

export interface ModelPage {
  data?: CatalogModel[];
  models?: CatalogModel[];
  stt?: CatalogModel[];
  nextPageToken?: string;
  has_more?: boolean;
  last_id?: string;
}

const nonChat = /(?:^|[\/_.-])(?:embedding[s]?|embed|tts|realtime|live|native-audio|moderation|guard|safeguard|orpheus|babbage|davinci|whisper|transcribe|transcription|rerank|sora|codex|instruct|dall-e|gpt-image|image|audio)(?:$|[\/_.-])/i;

export function modelsFromPages(id: ProviderId, pages: (ModelPage | CatalogModel[])[]): ProviderModels {
  const speech = new Map<string, string>();
  const ai = new Map<string, string>();

  for (const page of pages) {
    const rows = Array.isArray(page) ? page : page?.models ?? page?.stt ?? page?.data;
    if (!Array.isArray(rows)) continue;

    for (const row of rows) {
      if (!row || typeof row !== 'object' || row.active === false || row.lifecycle === 'retired') continue;
      const rawId = id === 'deepgram' ? row.canonical_name : id === 'elevenlabs' ? row.model_id : row.id ?? row.name;
      if (typeof rawId !== 'string' || !rawId.trim()) continue;
      const model = rawId.trim().replace(/^models\//, '');
      if (!model) continue;
      const label = row.display_name ?? row.displayName ?? row.name;
      const name = typeof label === 'string' && label.trim() && label !== rawId ? label.trim() : model;

      switch (id) {
        case 'deepgram':
          if (row.batch === true) speech.set(model, model);
          break;
        case 'elevenlabs':
          if ((row.can_do_speech_to_text || /^scribe_/i.test(model)) && !/(?:realtime|live)/i.test(model)) {
            speech.set(model, typeof row.name === 'string' && row.name.trim() ? row.name : model);
          }
          break;
        case 'anthropic':
          ai.set(model, name);
          break;
        case 'gemini':
          if (!Array.isArray(row.supportedGenerationMethods) || !row.supportedGenerationMethods.includes('generateContent')) break;
          if (/^gemini-.*transcribe/i.test(model)) {
            speech.set(model, name);
          } else if (!nonChat.test(model)) {
            ai.set(model, name);
            if (/^gemini-.*(?:flash|pro|argon|carbon|hydrogen|neon)/i.test(model)) speech.set(model, name);
          }
          break;
        default: {
          const inputs = row.architecture?.input_modalities;
          const outputs = row.architecture?.output_modalities;
          if (
            (Array.isArray(outputs) && outputs.includes('transcription')) ||
            /(?:whisper|transcrib|transcript|(?:^|[-_])stt(?:$|[-_]))/i.test(model)
          ) {
            speech.set(model, name);
            break;
          }
          if (Array.isArray(inputs) && Array.isArray(outputs)) {
            if (inputs.includes('text') && outputs.includes('text')) ai.set(model, name);
          } else if (!nonChat.test(model) && (id !== 'openai' || /^(?:gpt-|o[134](?:-|$)|ft:(?:gpt-|o[134]))/i.test(model))) {
            ai.set(model, name);
          }
        }
      }
    }
  }

  return {
    speech: Array.from(speech, ([id, label]) => ({ id, label })),
    ai: Array.from(ai, ([id, label]) => ({ id, label })),
  };
}
