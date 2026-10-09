/**
 * Provider-neutral persistence port for AgentOS core modules.
 * Concrete Supabase, Firebase, SQLite, and other implementations belong in adapters.
 */
let provider = null;

export function registerPersistenceProvider(nextProvider) {
  if (!nextProvider || typeof nextProvider !== 'object') throw new TypeError('A persistence provider is required');
  provider = nextProvider;
  return provider;
}

export function clearPersistenceProvider() { provider = null; }
export function getPersistenceProvider() { return provider; }
export function requirePersistenceProvider() {
  if (!provider) throw new Error('No persistence provider registered');
  return provider;
}

export default { registerPersistenceProvider, clearPersistenceProvider, getPersistenceProvider, requirePersistenceProvider };
