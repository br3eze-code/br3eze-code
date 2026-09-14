/** Backward-compatible shim for the domain-neutral persistence port. */
export {
  registerPersistenceProvider,
  clearPersistenceProvider,
  getPersistenceProvider,
  initialize as initializeFirebase,
  getStore as getFirestore,
  getApp as getFirebaseApp,
  getAuth,
  createAuthUser
} from './ports/persistence.js';

export const admin = undefined;
