/**
 * Domain-neutral network-device boundary.
 * Concrete RouterOS/MikroTik behavior is supplied by the host adapter.
 */
import { EventEmitter } from 'node:events';

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
export async function testConnection(options = {}) {
  try {
    const result = await requireProvider().testConnection(options);
    return typeof result === 'object' ? result : { success: Boolean(result) };
  } catch (error) {
    return { success: false, message: error.message };
  }
}
export const MikroTikManager = class NetworkManagerFacade extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.state = { isConnected: false, host: options.host || options.ip || null };
  }
  async connect() {
    const result = await getManager(this.options).connect();
    this.state.isConnected = true;
    this.emit('connected', { host: this.state.host, timestamp: new Date().toISOString() });
    return result;
  }
  async disconnect() {
    const result = await getManager(this.options).disconnect?.();
    this.state.isConnected = false;
    return result;
  }
  destroy() { return this.disconnect().catch(() => undefined); }
  executeTool(...args) {
    if (!provider) throw new ConnectionError('No network adapter registered');
    return getManager(this.options).executeTool(...args);
  }
  getState() {
    const manager = provider ? getManager(this.options) : null;
    return manager?.getState?.() || { ...this.state, availableTools: this.getAvailableTools().length };
  }
  getAvailableTools() {
    return provider ? (getManager(this.options).getAvailableTools?.() || []) : ['ping', 'user.add', 'user.remove', 'user.kick', 'system.stats'];
  }
  async getSystemStats() { return this.executeTool('system.stats'); }
  async getArpTable() { return this.executeTool('arp.table'); }
  async reboot() { return this.executeTool('system.reboot'); }
};
export class MikroTikError extends Error {}
export class ConnectionError extends MikroTikError {}
export class ToolExecutionError extends MikroTikError {}
export default MikroTikManager;
