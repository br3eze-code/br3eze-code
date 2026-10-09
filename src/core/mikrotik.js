/**
 * Domain-neutral network-device boundary.
 * Concrete RouterOS/MikroTik behavior is supplied by the host adapter.
 */
let provider = null;

function requireProvider() {
  if (!provider) throw new Error('No network adapter registered');
  return provider;
}

export function registerNetworkProvider(next) { if (!next) throw new TypeError('Network provider required'); provider = next; return provider; }
export function clearNetworkProvider() { provider = null; }
export function getNetworkProvider() { return provider; }
export function createManager(options = {}) { return requireProvider().createManager ? requireProvider().createManager(options) : requireProvider(); }
export function getManager(options = {}) { return requireProvider().getManager ? requireProvider().getManager(options) : requireProvider(); }
export function resetManager() { return provider?.resetManager?.(); }
export async function getMikroTikClient(options = {}) { return requireProvider().getMikroTikClient(options); }
export async function testConnection(options = {}) { return requireProvider().testConnection(options); }
export const MikroTikManager = class NetworkManagerFacade {
  constructor(options = {}) { this.options = options; }
  async connect() { return getManager(this.options).connect(); }
  async disconnect() { return getManager(this.options).disconnect?.(); }
  executeTool(...args) { return getManager(this.options).executeTool(...args); }
};
export class MikroTikError extends Error {}
export class ConnectionError extends MikroTikError {}
export class ToolExecutionError extends MikroTikError {}
export default MikroTikManager;
