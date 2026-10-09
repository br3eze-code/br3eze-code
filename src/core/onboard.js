/** Domain-neutral onboarding boundary. Concrete provisioning is supplied by adapters. */
let provider = null;
export function registerOnboardingProvider(next) { if (!next) throw new TypeError('Onboarding provider required'); provider = next; return provider; }
export function getOnboardingProvider() { return provider; }
export async function onboardRouter(...args) { if (!provider?.onboardRouter) throw new Error('No onboarding provider registered'); return provider.onboardRouter(...args); }
export async function onboardFleet(...args) { if (!provider?.onboardFleet) throw new Error('No onboarding provider registered'); return provider.onboardFleet(...args); }
export async function provisionAgents(...args) { if (!provider?.provisionAgents) throw new Error('No onboarding provider registered'); return provider.provisionAgents(...args); }
export async function generateSetupScript(...args) { if (!provider?.generateSetupScript) throw new Error('No onboarding provider registered'); return provider.generateSetupScript(...args); }
export async function testMikroTikConnection(...args) { if (!provider?.testConnection) throw new Error('No network adapter registered'); return provider.testConnection(...args); }
export const templateRsc = null;
export async function runWizard(...args) { if (!provider?.runWizard) throw new Error('No onboarding provider registered'); return provider.runWizard(...args); }
