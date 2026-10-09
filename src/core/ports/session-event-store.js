/**
 * Domain-neutral append-only session event store port.
 * Core owns event semantics; persistence is supplied by adapters.
 */

import { createProviderPort } from './provider-registry.js';

const port = createProviderPort('session-event-store');

export const registerSessionEventStore = (provider) => {
  if (!provider || typeof provider !== 'object') {
    throw new TypeError('A session event store provider is required');
  }
  for (const method of ['append', 'read', 'getLast']) {
    if (typeof provider[method] !== 'function') {
      throw new TypeError(`Session event store must implement ${method}()`);
    }
  }
  return port.register(provider);
};

export const clearSessionEventStore = () => port.clear();
export const getSessionEventStore = () => port.get();
export const requireSessionEventStore = () => port.require();
