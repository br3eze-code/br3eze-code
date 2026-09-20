import { EventEmitter } from 'node:events';
import { MikroTikManager } from './mikrotik.js';

/**
 * Plugin adapter facade for the concrete MikroTik driver.
 * The driver owns RouterOS details; this class exposes the common adapter
 * lifecycle expected by the plugin registry.
 */
let sharedClient = null;

export function getMikroTikClient(config = {}) {
  if (!sharedClient) sharedClient = new MikroTikManager(config);
  return sharedClient;
}

export default class MikroTikAdapter extends EventEmitter {
  constructor(config = {}) {
    super();
    this.name = 'mikrotik';
    this.type = 'network';
    this.config = config;
    this.driver = new MikroTikManager(config);
    this.connected = false;
    this.resources = new Map();
  }

  async connect() {
    const connected = await this.driver.connect();
    this.connected = Boolean(connected);
    return this;
  }

  async disconnect() {
    await this.driver.disconnect();
    this.connected = false;
  }

  async discover() {
    if (!this.connected) await this.connect();
    const identity = await this.driver.executeTool('system.identity');
    const resource = {
      id: this.config.resourceId || `network:mikrotik:${this.config.host || 'local'}`,
      type: 'network.resource',
      provider: 'mikrotik',
      name: identity?.[0]?.name || this.config.name || 'MikroTik Router',
      capabilities: this.listActions(),
      properties: { identity: identity?.[0] || null }
    };
    this.resources.set(resource.id, resource);
    this.emit('resource discovered', resource);
    return [resource];
  }

  async executeTool(action, params = {}) {
    return this.driver.executeTool(action, params);
  }

  async execute(resourceId, action, params = {}) {
    return this.executeTool(action, params, { resourceId });
  }

  async getMetrics() {
    return this.driver.getSystemStats();
  }

  getState() { return this.driver.getState?.() || { isConnected: this.connected, host: this.config.host || null, availableTools: this.listActions().length }; }
  getAvailableTools() { return this.listActions(); }
  getSystemStats() { return this.driver.getSystemStats(); }
  getArpTable() { return this.driver.executeTool('arp.table'); }
  reboot() { return this.driver.executeTool('system.reboot'); }

  listActions() {
    return [
      'ping', 'user.add', 'user.remove', 'user.kick', 'users.active', 'users.all',
      'system.stats', 'system.resources', 'system.uptime', 'system.identity',
      'system.logs', 'dhcp.leases', 'interface.list', 'arp.table', 'ip.addresses',
      'ip.routes', 'dns', 'firewall.list', 'nat.list', 'hotspot.profiles'
    ];
  }

  getCapabilities() {
    return { name: this.name, type: this.type, actions: this.listActions(), supportsRealtime: false };
  }

  async destroy() { await this.disconnect(); this.resources.clear(); this.removeAllListeners(); }
}
