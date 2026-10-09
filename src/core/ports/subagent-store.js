import { createProviderPort } from './provider-registry.js';

const port = createProviderPort('subagent-store');

export const registerSubagentStore = (provider) => {
  if (!provider || typeof provider !== 'object') throw new TypeError('A subagent store provider is required');
  for (const method of ['create', 'get', 'update']) {
    if (typeof provider[method] !== 'function') throw new TypeError(`Subagent store must implement ${method}()`);
  }
  return port.register(provider);
};
export const clearSubagentStore = () => port.clear();
export const getSubagentStore = () => port.get();
export const requireSubagentStore = () => port.require();
