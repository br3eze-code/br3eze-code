/**
 * Domain-neutral SessionStore port.
 * The kernel owns session semantics; concrete persistence belongs in adapters.
 */
import { createProviderPort } from './provider-registry.js';

const port = createProviderPort('session-store');

export const registerSessionStore = (provider) => {
  if (!provider || typeof provider !== 'object') throw new TypeError('A session store provider is required');
  for (const method of ['create', 'get', 'transition']) {
    if (typeof provider[method] !== 'function') throw new TypeError(`Session store must implement ${method}()`);
  }
  return port.register(provider);
};
export const clearSessionStore = () => port.clear();
export const getSessionStore = () => port.get();
export const requireSessionStore = () => port.require();
