/** Domain-neutral persistence capability boundary. */
let provider = null;
async function ensureProvider() { if (!provider) provider = await import('../adapters/persistence/firebase.js'); return provider; }
export function registerPersistenceProvider(nextProvider) { if (!nextProvider || typeof nextProvider !== 'object') throw new TypeError('A persistence provider is required'); provider = nextProvider; return provider; }
export function clearPersistenceProvider() { provider = null; }
export function getPersistenceProvider() { return provider; }
export async function initializeFirebase() { const p = await ensureProvider(); return p.initializeFirebase(); }
export async function getFirestore() { const p = await ensureProvider(); return p.getFirestore(); }
export async function getFirebaseApp() { const p = await ensureProvider(); return p.getFirebaseApp(); }
export async function getAuth() { const p = await ensureProvider(); return p.getAuth(); }
export async function createAuthUser(identifier, opts = {}) { const p = await ensureProvider(); return p.createAuthUser(identifier, opts); }
export async function getDatabase() { return null; }
