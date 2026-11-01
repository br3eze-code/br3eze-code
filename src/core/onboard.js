/** Compatibility facade for the canonical onboarding provider port. */
export {
  registerOnboardingProvider,
  clearOnboardingProvider,
  getOnboardingProvider,
  onboardRouter,
  onboardFleet,
  provisionAgents,
  generateSetupScript,
  runWizard,
} from './ports/onboarding.js';

import { getOnboardingProvider } from './ports/onboarding.js';

// Legacy export retained for callers that check for a template hook.
export const templateRsc = null;

export async function testMikroTikConnection(...args) {
  const provider = getOnboardingProvider();
  if (typeof provider?.testConnection !== 'function') {
    throw new Error('No network adapter registered');
  }
  return provider.testConnection(...args);
}
