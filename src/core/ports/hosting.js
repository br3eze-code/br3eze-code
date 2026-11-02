import { createProviderPort } from './provider-registry.js';

const registry = createProviderPort('hosting');
const CAPABILITIES = new Set([
  'runtime-info', 'health', 'deploy', 'scale', 'logs', 'secrets',
  'object-storage', 'queues', 'scheduler', 'networking',
  'static-assets', 'durable-storage'
]);
const REQUIRED_METHODS = Object.freeze({
  'runtime-info': 'getRuntimeInfo',
  health: 'healthCheck',
  deploy: 'deploy',
  scale: 'scale',
  logs: 'getLogs',
  secrets: 'getSecret',
  'object-storage': 'getObjectStorage',
  queues: 'getQueue',
  scheduler: 'getScheduler',
  networking: 'getNetwork',
  'static-assets': 'getStaticAssetStore',
  'durable-storage': 'getDurableStorage'
});

export function assertHostingProvider(provider) {
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) throw new TypeError('A hosting provider adapter is required');
  if (typeof provider.id !== 'string' || !/^[a-z][a-z0-9-]{1,62}$/.test(provider.id)) throw new TypeError('Hosting provider id must be a lowercase provider identifier');
  if (!Array.isArray(provider.capabilities) || !provider.capabilities.length) throw new TypeError('Hosting provider must declare at least one capability');
  const seen = new Set();
  for (const capability of provider.capabilities) {
    if (!CAPABILITIES.has(capability)) throw new TypeError('Unsupported hosting capability: ' + capability);
    if (seen.has(capability)) throw new TypeError('Duplicate hosting capability: ' + capability);
    seen.add(capability);
    const method = REQUIRED_METHODS[capability];
    if (typeof provider[method] !== 'function') throw new TypeError('Hosting provider ' + provider.id + ' declares ' + capability + ' but does not implement ' + method);
  }
  if (typeof provider.getRuntimeInfo !== 'function' || typeof provider.healthCheck !== 'function') throw new TypeError('Hosting providers must implement getRuntimeInfo() and healthCheck()');
  return provider;
}
export function registerHostingProvider(provider) { return registry.register(assertHostingProvider(provider)); }
export const clearHostingProvider = () => registry.clear();
export const getHostingProvider = () => registry.get();
export const requireHostingProvider = () => registry.require();
export const HOSTING_CAPABILITIES = Object.freeze([...CAPABILITIES]);
