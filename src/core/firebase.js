/**
 * Domain-neutral persistence capability boundary.
 * Concrete providers are registered by the host; Core never imports one.
 */
let provider = null;

function requireProvider() {
  if (!provider) throw new Error('No persistence provider registered');
  return provider;
}

export function registerPersistenceProvider(nextProvider) {
  if (!nextProvider || typeof nextProvider !== 'object') throw new TypeError('A persistence provider is required');
  provider = nextProvider;
  return provider;
}
export function clearPersistenceProvider() { provider = null; }
export function getPersistenceProvider() { return provider; }
export function initializeFirebase() { return requireProvider().initializeFirebase(); }
export function getFirestore() { return requireProvider().getFirestore(); }
export function getFirebaseApp() { return requireProvider().getFirebaseApp(); }
export function getAuth() { return requireProvider().getAuth(); }
export async function createAuthUser(identifier, opts = {}) { return requireProvider().createAuthUser(identifier, opts); }
export async function getDatabase() { return requireProvider().getDatabase?.() || null; }
export const admin = undefined;
