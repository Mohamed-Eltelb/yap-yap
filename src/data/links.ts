import type { ProviderId } from '../types/app';

/** The Yap Yap website. Change it here when the site moves to its own domain. */
export const SITE_URL = 'https://yapyap-app.vercel.app';

export const siteLinks = {
  home: `${SITE_URL}/`,
  /** How to get each provider's key, and what it costs. */
  setupGuide: `${SITE_URL}/providers.html`,
  /** Recommended dictation + AI combinations. */
  bestSetups: `${SITE_URL}/use-cases.html`,
  /** What's new in each release. */
  releaseNotes: `${SITE_URL}/release-notes.html`,
  /** What Yap Yap collects (nothing) and where data goes. */
  privacy: `${SITE_URL}/privacy.html`,
};

/** The setup guide's section for one provider. */
export function providerGuideUrl(id: ProviderId): string {
  return `${siteLinks.setupGuide}#${id === 'anthropic' ? 'claude' : id}`;
}
