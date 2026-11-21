import { isProviderConfigured } from './providers/catalog';
import type { PersistedAppState } from './storage';

/**
 * First-run setup shows until it is finished or skipped, and only while no provider has a key,
 * so people who set Yap Yap up before setup existed never see it.
 */
export function shouldShowOnboarding(state: Pick<PersistedAppState, 'settings' | 'providers'>): boolean {
  return !state.settings.onboardingDone && !Object.values(state.providers).some(isProviderConfigured);
}
