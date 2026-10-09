/**
 * Domain-neutral persistence capability boundary.
 * Concrete providers are registered by the host; Core never imports one.
 */
import {
  registerPersistenceProvider,
  clearPersistenceProvider,
  getPersistenceProvider,
  requirePersistenceProvider
} from './persistence.js';

function requireProvider() { return requirePersistenceProvider(); }

export { registerPersistenceProvider, clearPersistenceProvider, getPersistenceProvider };
export function initializeFirebase() { return requireProvider().initializeFirebase(); }
export function getFirestore() { return requireProvider().getFirestore(); }
export function getFirebaseApp() { return requireProvider().getFirebaseApp(); }
export function getAuth() { return requireProvider().getAuth(); }
export async function createAuthUser(identifier, opts = {}) { return requireProvider().createAuthUser(identifier, opts); }
export async function getDatabase() { return requireProvider().getDatabase?.() || null; }
export const admin = undefined;
