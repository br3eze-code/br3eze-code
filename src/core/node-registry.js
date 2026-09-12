import EventEmitter from 'node:events';
import { logger } from './logger.js';
import { createManager } from './mikrotik.js';

/**
 * NodeRegistry manages named domain adapter nodes.
 * The registry itself is domain-neutral; adapters provide createManager().
 */
class NodeRegistry extends EventEmitter {
  constructor() {
    super();
    this._nodes = new Map();
  }

  add(name, ip, user, pass, port = 8728) {
    if (this._nodes.has(name)) {
      try { this._nodes.get(name).destroy?.(); } catch { /* ignore */ }
    }
    const node = createManager({ host: ip, port, username: user, password: pass });
    this._nodes.set(name, node);
    logger.info(`NodeRegistry: registered "${name}" (${ip}:${port})`);
    this.emit('nodeAdded', { name, ip });
    return node;
  }

  get(name) { return this._nodes.get(name) || null; }

  getAll() {
    return [...this._nodes.entries()].map(([name, node]) => ({
      name,
      ip: node._config?.host || 'unknown',
      port: node._config?.port || 8728,
      connected: node.isConnected ?? false,
    }));
  }

  async connectAll() {
    const results = [];
    for (const [name, node] of this._nodes) {
      try {
        await node.connect();
        results.push({ name, status: 'connected' });
        this.emit('nodeConnected', { name });
      } catch (err) {
        results.push({ name, status: 'failed', error: err.message });
        this.emit('nodeError', { name, error: err.message });
      }
    }
    return results;
  }

  async executeOnNode(name, tool, ...args) {
    const node = this._nodes.get(name);
    if (!node) throw new Error(`Node not found: ${name}`);
    return node.executeTool(tool, ...args);
  }

  async executeOnAll(tool, ...args) {
    const results = {};
    for (const [name, node] of this._nodes) {
      if (!(node.isConnected ?? false)) {
        results[name] = { error: 'offline' };
        continue;
      }
      try {
        results[name] = await node.executeTool(tool, ...args);
      } catch (err) {
        results[name] = { error: err.message };
      }
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

  disconnectAll() {
    for (const node of this._nodes.values()) {
      try { node.destroy?.(); } catch { /* ignore */ }
    }
    this._nodes.clear();
  }
}

export { NodeRegistry };
export default new NodeRegistry();
