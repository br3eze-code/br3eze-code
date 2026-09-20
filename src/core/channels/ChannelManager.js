import EventEmitter from 'node:events';
import { logger } from '../logger.js';

/**
 * ChannelManager is a transport-neutral registry. Concrete transports are
 * injected by the host application; Core never imports Telegram, WhatsApp,
 * Slack, email, SMS, or any other messaging SDK.
 */
export class ChannelManager extends EventEmitter {
  constructor(agent, { adapters = [], maxAdapters = Infinity, maxChannels = Infinity } = {}) {
    super();
    this.agent = agent;
    this.maxAdapters = Number.isFinite(maxAdapters) ? Math.max(1, maxAdapters) : Infinity;
    this.maxChannels = Number.isFinite(maxChannels) ? Math.max(1, maxChannels) : Infinity;
    this.channels = new Map();
    this.bindings = new Map();
    this.adapters = new Map();
    for (const adapter of adapters) this.registerAdapter(adapter);
  }
  registerAdapter(adapter) {
    if (!adapter?.type || typeof adapter.create !== 'function') throw new TypeError('Channel adapter requires type and create()');
    if (!this.adapters.has(adapter.type) && this.adapters.size >= this.maxAdapters) throw new Error('Channel adapter limit reached');
    this.adapters.set(adapter.type, adapter);
    return adapter.type;
  }
  unregisterAdapter(type) { this.adapters.delete(type); return this; }
  async register(spec = {}) {
    const type = String(spec.type || '').trim().toLowerCase();
    const adapter = this.adapters.get(type);
    if (!adapter) throw new Error(`No channel adapter registered for '${type}'`);
    const tenantId = String(spec.tenantId || spec.config?.tenantId || '').trim();
    const siteId = String(spec.siteId || spec.config?.siteId || '').trim();
    const accountId = String(spec.accountId || spec.config?.accountId || type).trim();
    if (!tenantId || !siteId) throw new Error('Channel registration requires tenantId and siteId');
    const bindingKey = `${tenantId}:${siteId}:${type}:${accountId}`;
    if (!this.bindings.has(bindingKey) && this.bindings.size >= this.maxChannels) throw new Error('Channel limit reached');
    const instance = await adapter.create({ ...(spec.config || {}), tenantId, siteId, accountId, domain: spec.domain || spec.config?.domain || null }, this.agent);
    if (!instance || typeof instance.send !== 'function') throw new Error(`Channel adapter '${type}' returned an invalid channel`);
    this.channels.set(bindingKey, instance);
    this.bindings.set(bindingKey, { tenantId, siteId, type, accountId });
    this.emit('channel:registered', { type, tenantId, siteId, accountId, bindingKey });
    return instance;
  }
  async initialize() {
    const configured = Array.isArray(this.agent?.config?.channels) ? this.agent.config.channels : [];
    for (const spec of configured) {
      try { await this.register(spec); } catch (error) { logger.warn(`Channel '${spec.type}' unavailable: ${error.message}`); }
    }
    return this.channels;
  }
  get(type, scope = {}) {
    const tenantId = String(scope.tenantId || '').trim();
    const siteId = String(scope.siteId || '').trim();
    const accountId = String(scope.accountId || type).trim();
    if (!tenantId || !siteId) return null;
    return this.channels.get(`${tenantId}:${siteId}:${type}:${accountId}`) || null;
  }
  list(scope = {}) {
    const tenantId = String(scope.tenantId || '').trim();
    const siteId = String(scope.siteId || '').trim();
    return [...this.bindings.entries()].filter(([, binding]) => (!tenantId || binding.tenantId === tenantId) && (!siteId || binding.siteId === siteId)).map(([key]) => key);
  }
  status() {
    return { adapters: [...this.adapters.keys()], channels: this.list(), adapterCount: this.adapters.size, channelCount: this.channels.size, maxAdapters: this.maxAdapters, maxChannels: this.maxChannels };
  }
  async send(type, target, payload, scope = {}) {
    const channel = this.get(type, scope);
    if (!channel) throw new Error(`Channel not registered for tenant/site scope: ${type}`);
    return channel.send(target, payload);
  }
  async shutdown() {
    await Promise.allSettled([...this.channels.values()].map(channel => channel.close?.() || channel.destroy?.()));
    this.channels.clear();
    this.emit('channels:shutdown');
  }
  destroy() { return this.shutdown(); }
}
export default ChannelManager;
