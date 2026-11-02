/**
 * Domain-neutral append-only session event store port.
 * Core owns event semantics; persistence is supplied by adapters.
 */

import { createProviderPort } from './provider-registry.js';
import { SessionEventStore } from '../session/SessionEventStore.js';

const port = createProviderPort('session-event-store');
let defaultStore = null;

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

export const clearSessionEventStore = () => { defaultStore = null; return port.clear(); };
export const getSessionEventStore = () => port.get();
export const requireSessionEventStore = () => port.require();

/** Shared default event store; hosts may replace it with a registered adapter. */
export const getOrCreateSessionEventStore = () => port.get() || (defaultStore ||= new SessionEventStore());
