import EventEmitter from 'events';
import { logger } from './logger.js';

/**
 * NodeRegistry — domain-neutral registry for externally supplied node managers.
 * The kernel does not construct or import vendor/domain clients.
 */
class NodeRegistry extends EventEmitter {
    constructor({ managerFactory = null } = {}) {
        super();
        this.managerFactory = managerFactory;
        this._nodes = new Map();
    }

    setManagerFactory(managerFactory) {
        if (typeof managerFactory !== 'function') throw new TypeError('managerFactory must be a function');
        this.managerFactory = managerFactory;
        return this;
    }

    add(name, endpoint, user, secret, port) {
        if (!name) throw new TypeError('Node name is required');
        if (typeof this.managerFactory !== 'function') throw new Error('No node manager factory configured');
        if (this._nodes.has(name)) {
            try { this._nodes.get(name).destroy?.(); } catch { /* ignore */ }
        }
        const node = this.managerFactory({ host: endpoint, user, password: secret, port });
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
                await node.connect();
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
        return node.executeTool(tool, ...args);
    }

    async executeOnAll(tool, ...args) {
        const results = {};
        for (const [name, node] of this._nodes) {
            if (!(node?.isConnected ?? node?.state?.isConnected ?? false)) {
                results[name] = { error: 'offline' };
                continue;
            }
            try { results[name] = await node.executeTool(tool, ...args); }
            catch (error) { results[name] = { error: error.message }; }
        }
        return results;
    }

    remove(name) {
        const node = this._nodes.get(name);
        if (node) {
            try { node.destroy?.(); } catch { /* ignore */ }
            this._nodes.delete(name);
            this.emit('nodeRemoved', { name });
        }
    }

    disconnectAll() {
        for (const node of this._nodes.values()) {
            try { node.destroy?.(); } catch { /* ignore */ }
        }
        this._nodes.clear();
    }
}

export default new NodeRegistry();
