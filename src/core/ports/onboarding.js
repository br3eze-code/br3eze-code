import { createProviderPort } from './provider-registry.js';

const port = createProviderPort('onboarding');
export const registerOnboardingProvider = (provider) => port.register(provider);
export const clearOnboardingProvider = () => port.clear();
export const getOnboardingProvider = () => port.get();
const call = (method, args) => {
  const provider = port.require();
  if (typeof provider[method] !== 'function') throw new Error(`Onboarding provider does not implement ${method}()`);
  return provider[method](...args);
};
export const onboardRouter = (...args) => call('onboardRouter', args);
export const onboardFleet = (...args) => call('onboardFleet', args);
export const provisionAgents = (...args) => call('provisionAgents', args);
export const generateSetupScript = (...args) => call('generateSetupScript', args);
export const runWizard = (...args) => call('runWizard', args);
