/**
 * Domain-neutral network-device boundary.
 * Concrete RouterOS/MikroTik behavior is supplied by the host adapter.
 */
let provider = null;

function requireProvider() {
  if (!provider) throw new Error('No network adapter registered');
  return provider;
}

export function registerNetworkProvider(next) {
  if (!next) throw new TypeError('Network provider required');
  provider = next;
  return provider;
}
export function clearNetworkProvider() { provider = null; }
export function getNetworkProvider() { return provider; }
export function createManager(options = {}) {
  const current = requireProvider();
  return current.createManager ? current.createManager(options) : current;
}
export function getManager(options = {}) {
  const current = requireProvider();
  return current.getManager ? current.getManager(options) : current;
}
export function resetManager() { return provider?.resetManager?.(); }
export async function getMikroTikClient(options = {}) { return requireProvider().getMikroTikClient(options); }
export async function testConnection(options = {}) { return requireProvider().testConnection(options); }

export class NetworkManagerFacade {
  constructor(options = {}) { this.options = options; }

  // Configuration can be reported without initializing or connecting an adapter.
  get isConfigured() {
    return Boolean(this.options.host || this.options.address || provider?.isConfigured === true);
  }

  async connect() {
    // An optional network adapter must not prevent the general-purpose runtime
    // from starting when network integration has not been installed.
    if (!provider || !this.isConfigured) return false;
    const manager = getManager(this.options);
    if (manager?.isConfigured === false) return false;
    return manager.connect();
  }

  async disconnect() {
    if (!provider) return false;
    return getManager(this.options).disconnect?.() ?? false;
  }

  executeTool(...args) { return getManager(this.options).executeTool(...args); }
}

export const MikroTikManager = NetworkManagerFacade;
export class MikroTikError extends Error {}
export class ConnectionError extends MikroTikError {}
export class ToolExecutionError extends MikroTikError {}
export default MikroTikManager;
