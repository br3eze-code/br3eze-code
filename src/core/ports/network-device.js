import { createProviderPort } from './provider-registry.js';

const port = createProviderPort('network');

export const registerNetworkProvider = (provider) => port.register(provider);
export const clearNetworkProvider = () => port.clear();
export const getNetworkProvider = () => port.get();
export const requireNetworkProvider = () => port.require();
export const createManager = (options = {}) => {
  const provider = port.require();
  return provider.createManager ? provider.createManager(options) : provider;
};
export const getManager = (options = {}) => {
  const provider = port.require();
  return provider.getManager ? provider.getManager(options) : provider;
};
export const resetManager = () => port.get()?.resetManager?.();
export const getClient = async (options = {}) => port.require().getMikroTikClient
  ? port.require().getMikroTikClient(options)
  : port.require().getClient?.(options);
export const testConnection = async (options = {}) => port.require().testConnection(options);

export class NetworkManagerFacade {
  constructor(options = {}) { this.options = options; }
  async connect() { return getManager(this.options).connect(); }
  async disconnect() { return getManager(this.options).disconnect?.(); }
  executeTool(...args) { return getManager(this.options).executeTool(...args); }
}
