import EventEmitter from 'node:events';
import { logger } from '../logger.js';

/**
 * ChannelManager is a transport-neutral registry. Concrete transports are
 * injected by the host application; Core never imports Telegram, WhatsApp,
 * Slack, email, SMS, or any other messaging SDK.
 */
export class ChannelManager extends EventEmitter {
  constructor(agent, { adapters = [] } = {}) {
    super();
    this.agent = agent;
    this.channels = new Map();
    this.adapters = new Map();
    for (const adapter of adapters) this.registerAdapter(adapter);
  }
  registerAdapter(adapter) {
    if (!adapter?.type || typeof adapter.create !== 'function') throw new TypeError('Channel adapter requires type and create()');
    this.adapters.set(adapter.type, adapter);
    return adapter.type;
  }
  unregisterAdapter(type) { this.adapters.delete(type); return this; }
  async register(spec = {}) {
    const type = spec.type;
    const adapter = this.adapters.get(type);
    if (!adapter) throw new Error(`No channel adapter registered for '${type}'`);
    const instance = await adapter.create(spec.config || {}, this.agent);
    if (!instance || typeof instance.send !== 'function') throw new Error(`Channel adapter '${type}' returned an invalid channel`);
    this.channels.set(type, instance);
    this.emit('channel:registered', { type });
    return instance;
  }
  async initialize() {
    const configured = Array.isArray(this.agent?.config?.channels) ? this.agent.config.channels : [];
    for (const spec of configured) {
      try { await this.register(spec); } catch (error) { logger.warn(`Channel '${spec.type}' unavailable: ${error.message}`); }
    }
    return this.channels;
  }
  get(type) { return this.channels.get(type) || null; }
  list() { return [...this.channels.keys()]; }
  async send(type, target, payload) {
    const channel = this.get(type);
    if (!channel) throw new Error(`Channel not registered: ${type}`);
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
