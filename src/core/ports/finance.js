import { createProviderPort } from './provider-registry.js';

const port = createProviderPort('financial');
export const registerFinancialProvider = (provider) => {
  if (typeof provider !== 'function') throw new TypeError('Financial provider must be a constructor');
  return port.register(provider);
};
export const clearFinancialProvider = () => port.clear();
export const getFinancialProvider = () => port.require();
export const createFinancial = (config = {}) => new (port.require())(config);
