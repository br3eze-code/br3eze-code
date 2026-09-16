import { createProviderPort } from './provider-registry.js';

const port = createProviderPort('database');
export const registerDatabaseProvider = (provider) => {
  if (!provider || typeof provider.getDatabase !== 'function') throw new TypeError('Database provider must expose getDatabase()');
  return port.register(provider);
};
export const clearDatabaseProvider = () => port.clear();
export const getDatabaseProvider = () => port.get();
export const getDatabase = async () => port.require().getDatabase();
