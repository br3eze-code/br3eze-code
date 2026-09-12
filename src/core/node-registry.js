import EventEmitter from 'node:events';
import { logger } from './logger.js';

/**
 * Domain-neutral node registry.
 * Concrete node adapters are injected by the domain/infrastructure layer.
 */
class NodeRegistry extends EventEmitter {
  constructor({ factory = null } = {}) {
    super();
    this.factory = factory;
    this._nodes = new Map();
  }

  registerFactory(factory) {
    if (!factory || typeof factory.create !== 'function') throw new TypeError('node factory must expose create()');
    this.factory = factory;
    return this;
  }

  add(name, ...config) {
    if (!this.factory?.create) throw new Error('No node adapter factory registered');
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
  getAll() { return [...this._nodes.keys()].map((name) => ({ name })); }

  async connectAll() {
    const results = [];
    for (const [name, node] of this._nodes) {
      try { await node.connect?.(); results.push({ name, status: 'connected' }); this.emit('nodeConnected', { name }); }
      catch (err) { results.push({ name, status: 'failed', error: err.message }); this.emit('nodeError', { name, error: err.message }); }
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
      if (node.isConnected === false) { results[name] = { error: 'offline' }; continue; }
      try { results[name] = await node.executeTool(tool, ...args); }
      catch (err) { results[name] = { error: err.message }; }
    }
    return results;
  }

  remove(name) {
    const node = this._nodes.get(name);
    if (!node) return;
    try { node.destroy?.(); } catch { /* ignore */ }
    this._nodes.delete(name);
    this.emit('nodeRemoved', { name });
  }

  disconnectAll() { for (const name of this._nodes.keys()) this.remove(name); }
}

export { NodeRegistry };
export default new NodeRegistry();
