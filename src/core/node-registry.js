import EventEmitter from 'node:events';
import { logger } from './logger.js';

/**
 * Domain-neutral registry for externally supplied node adapters.
 * Core owns registry lifecycle; adapters own protocol-specific behavior.
 */
class NodeRegistry extends EventEmitter {
  constructor({ factory = null, managerFactory = null } = {}) {
    super();
    this.factory = factory;
    if (!this.factory && typeof managerFactory === 'function') {
      this.factory = {
        create: (...config) => managerFactory({
          host: config[0],
          user: config[1],
          password: config[2],
          port: config[3],
        }),
      };
    }
    this._nodes = new Map();
  }

  registerFactory(factory) {
    if (!factory || typeof factory.create !== 'function') {
      throw new TypeError('node factory must expose create()');
    }
    this.factory = factory;
    return this;
  }

  setManagerFactory(managerFactory) {
    if (typeof managerFactory !== 'function') {
      throw new TypeError('managerFactory must be a function');
    }
    this.factory = {
      create: (...config) => managerFactory({
        host: config[0],
        user: config[1],
        password: config[2],
        port: config[3],
      }),
    };
    return this;
  }

  add(name, ...config) {
    if (!this.factory || typeof this.factory.create !== 'function') {
      throw new Error('No node adapter factory registered');
    }
    if (!name || typeof name !== 'string') throw new TypeError('node name is required');
    if (this._nodes.has(name)) this.remove(name);
    const node = this.factory.create(...config);
    if (!node) throw new Error(`Node adapter failed to create: ${name}`);
    this._nodes.set(name, node);
    logger.info(`NodeRegistry: registered "${name}"`);
    this.emit('nodeAdded', { name });
    return node;
  }

  get(name) { return this._nodes.get(name) || null; }

  getAll() {
    return [...this._nodes.entries()].map(([name, node]) => ({
      name,
      connected: node?.isConnected ?? node?.state?.isConnected ?? false,
    }));
  }

  async connectAll() {
    const results = [];
    for (const [name, node] of this._nodes) {
      try {
        await node.connect?.();
        results.push({ name, status: 'connected' });
        this.emit('nodeConnected', { name });
      } catch (error) {
        results.push({ name, status: 'failed', error: error.message });
        this.emit('nodeError', { name, error: error.message });
      }
    }
    return results;
  }

  async executeOnNode(name, tool, ...args) {
    const node = this._nodes.get(name);
    if (!node) throw new Error(`Node not found: ${name}`);
    if (typeof node.executeTool !== 'function') throw new Error(`Node ${name} does not support tool execution`);
    return node.executeTool(tool, ...args);
  }

  async executeOnAll(tool, ...args) {
    const results = {};
    for (const [name, node] of this._nodes) {
      if (!(node?.isConnected ?? node?.state?.isConnected ?? true)) {
        results[name] = { error: 'offline' };
        continue;
      }
      try {
        results[name] = await node.executeTool(tool, ...args);
      } catch (error) {
        results[name] = { error: error.message };
      }
    }
    return results;
  }

  remove(name) {
    const node = this._nodes.get(name);
    if (!node) return;
    try { node.destroy?.(); } catch { /* Adapter cleanup must not block registry cleanup. */ }
    this._nodes.delete(name);
    this.emit('nodeRemoved', { name });
  }

  disconnectAll() {
    for (const name of [...this._nodes.keys()]) this.remove(name);
  }
}

export { NodeRegistry };
export default new NodeRegistry();
