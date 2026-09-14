import { createProviderPort } from './provider-registry.js';

const port = createProviderPort('persistence');
export const registerPersistenceProvider = (provider) => {
  if (!provider || typeof provider !== 'object') throw new TypeError('A persistence provider is required');
  return port.register(provider);
};
export const clearPersistenceProvider = () => port.clear();
export const getPersistenceProvider = () => port.get();
export const requirePersistenceProvider = () => port.require();
export const initialize = () => port.require().initializeFirebase?.() ?? port.require().initialize?.();
export const getStore = () => port.require().getFirestore?.() ?? port.require().getDatabase?.();
export const getApp = () => port.require().getFirebaseApp?.();
export const getAuth = () => port.require().getAuth?.();
export const createAuthUser = (identifier, options = {}) => port.require().createAuthUser(identifier, options);
