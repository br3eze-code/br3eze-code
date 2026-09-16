import { createProviderPort } from './provider-registry.js';

const port = createProviderPort('billing');
export const registerBillingProvider = (provider) => {
  if (typeof provider !== 'function' && typeof provider?.create !== 'function') {
    throw new TypeError('Billing provider must be a constructor or factory');
  }
  return port.register(provider);
};
export const clearBillingProvider = () => port.clear();
export const getBillingProvider = () => port.require();
export const createBilling = (config = {}) => {
  const Provider = port.require();
  return typeof Provider.create === 'function' ? Provider.create(config) : new Provider(config);
};
