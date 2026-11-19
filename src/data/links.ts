import type { ProviderId } from '../types/app';

/** The Yap Yap website. Change it here when the site moves to its own domain. */
export const SITE_URL = 'https://yap-yap-voice.aboeltalabib21.chatgpt.site';

export const siteLinks = {
  home: `${SITE_URL}/`,
  /** How to get each provider's key, and what it costs. */
  setupGuide: `${SITE_URL}/providers.html`,
  /** Recommended dictation + AI combinations. */
  bestSetups: `${SITE_URL}/use-cases.html`,
};

/** The setup guide's section for one provider. */
export function providerGuideUrl(id: ProviderId): string {
  return `${siteLinks.setupGuide}#${id === 'anthropic' ? 'claude' : id}`;
}
