/** Backward-compatible shim for the domain-neutral onboarding port. */
export {
  registerOnboardingProvider,
  clearOnboardingProvider,
  getOnboardingProvider,
  onboardRouter,
  onboardFleet,
  provisionAgents,
  generateSetupScript,
  runWizard
} from './ports/onboarding.js';

export const templateRsc = null;
export async function testMikroTikConnection(...args) {
  const { testConnection } = await import('./ports/network-device.js');
  return testConnection(...args);
}
