/**
 * Provider-neutral bridge to the host's product query capability.
 * Concrete SQLite/Firebase composition lives in src/adapters/persistence.
 */
import { getPersistenceProvider } from './persistence.js';

async function getProductQueryService() {
  const provider = getPersistenceProvider();
  if (!provider || typeof provider.getProductQueryService !== 'function') return null;
  return provider.getProductQueryService();
}

async function resetProductQueryServiceBridge() {
  const provider = getPersistenceProvider();
  if (typeof provider?.resetProductQueryServiceBridge === 'function') {
    await provider.resetProductQueryServiceBridge();
  }
}

export { getProductQueryService, resetProductQueryServiceBridge };
