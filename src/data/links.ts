import type { ProviderId } from '../types/app';

/** The Yap Yap website. Change it here when the site moves to its own domain. */
export const SITE_URL = 'https://yapyapapp.site';

export const siteLinks = {
  home: `${SITE_URL}/`,
  /** Guides and troubleshooting for every part of the app. */
  helpCenter: `${SITE_URL}/help.html`,
  /** How to get each provider's key, and what it costs. */
  setupGuide: `${SITE_URL}/providers.html`,
  /** Recommended dictation + AI combinations. */
  bestSetups: `${SITE_URL}/use-cases.html`,
  /** What's new in each release. */
  releaseNotes: `${SITE_URL}/release-notes.html`,
  /** What Yap Yap collects (nothing) and where data goes. */
  privacy: `${SITE_URL}/privacy.html`,
};

/** The app's GitHub repository. */
export const REPO_URL = 'https://github.com/Mohamed-Eltelb/yap-yap';

/** Lets people pick a bug report or feature request form. */
export const feedbackUrl = `${REPO_URL}/issues/new/choose`;

/** The setup guide's section for one provider. */
export function providerGuideUrl(id: ProviderId): string {
  return `${siteLinks.setupGuide}#${id === 'anthropic' ? 'claude' : id}`;
}
