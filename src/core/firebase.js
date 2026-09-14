/**
 * Persistence capability boundary.
 * Core does not know Firebase or any concrete provider. A host application
 * injects a persistence provider before requesting provider-backed operations.
 */
let provider = null;

export function registerPersistenceProvider(nextProvider) {
  if (!nextProvider || typeof nextProvider !== 'object') throw new TypeError('A persistence provider is required');
  provider = nextProvider;
  return provider;
}
export function clearPersistenceProvider() { provider = null; }
export function getPersistenceProvider() { return provider; }
export function initializeFirebase() { return provider?.initializeFirebase?.() || { app: null, db: null }; }
export function getFirestore() { return provider?.getFirestore?.() || null; }
export function getFirebaseApp() { return provider?.getFirebaseApp?.() || null; }
export function getAuth() { return provider?.getAuth?.() || null; }
export async function createAuthUser(identifier, opts = {}) { return provider?.createAuthUser ? provider.createAuthUser(identifier, opts) : null; }
export async function getDatabase() { return provider?.getDatabase ? provider.getDatabase() : null; }
export const admin = undefined;
