import { Settings2 } from 'lucide-react';
import claudeLogo from '../assets/providers/claude.svg';
import deepgramLogo from '../assets/providers/deepgram.svg';
import elevenlabsLogo from '../assets/providers/elevenlabs.svg';
import geminiLogo from '../assets/providers/gemini.svg';
import groqLogo from '../assets/providers/groq.svg';
import openaiLogo from '../assets/providers/openai.svg';
import type { ProviderId } from '../types/app';

export const providerLogos: Record<Exclude<ProviderId, 'custom'>, string> = {
  anthropic: claudeLogo,
  deepgram: deepgramLogo,
  elevenlabs: elevenlabsLogo,
  gemini: geminiLogo,
  groq: groqLogo,
  openai: openaiLogo,
};

/** Black logos that need inverting on a dark background. */
const MONOCHROME = new Set<ProviderId>(['groq', 'openai', 'deepgram', 'elevenlabs']);

/** A provider's logo, sized to `size`; the custom provider gets a generic icon. */
export function ProviderLogo({ id, size = 16 }: { id: ProviderId; size?: number }) {
  if (id === 'custom') return <Settings2 size={size} aria-hidden="true" />;
  return (
    <img
      src={providerLogos[id]}
      alt=""
      width={size}
      height={size}
      className={`object-contain ${MONOCHROME.has(id) ? 'dark:invert' : ''}`}
    />
  );
}
