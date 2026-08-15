import EventEmitter from 'node:events';
import { logger } from './logger.js';

const SUPPORTED_KINDS = new Set(['mikrotik', 'hikvision', 'dahua', 'generic']);

function normalizeServer(input = {}) {
  const id = String(input.id || input.name || '').trim();
  if (!id) throw new Error('Server definition requires an id.');
  const kind = String(input.kind || input.type || 'generic').toLowerCase();
  if (!SUPPORTED_KINDS.has(kind)) throw new Error(`Unsupported server kind: ${kind}`);
  return {
    id,
    name: input.name || id,
    kind,
    host: input.host || input.ip || null,
    port: input.port || null,
    enabled: input.enabled !== false,
    tags: Array.isArray(input.tags) ? [...new Set(input.tags.map(String))] : [],
    capabilities: Array.isArray(input.capabilities) ? [...new Set(input.capabilities.map(String))] : [],
    credentialRef: input.credentialRef || input.credentialsEnv || null,
    metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {}
  };
}

class ServerRegistry extends EventEmitter {
  constructor() {
    super();
    this._servers = new Map();
    this._revision = 0;
    this._updatedAt = null;
  }

  configure(definitions = []) {
    if (!Array.isArray(definitions)) throw new TypeError('servers must be an array.');
    const next = new Map();
    for (const definition of definitions) {
      const server = normalizeServer(definition);
      next.set(server.id, server);
    }
    this._servers = next;
    this._revision += 1;
    this._updatedAt = new Date().toISOString();
    this.emit('configured', this.snapshot());
    return this.snapshot();
  }

  upsert(definition) {
    const server = normalizeServer(definition);
    this._servers.set(server.id, server);
    this._revision += 1;
    this._updatedAt = new Date().toISOString();
    this.emit('serverChanged', { action: 'upsert', server });
    return server;
  }

  remove(id) {
    const removed = this._servers.delete(String(id));
    if (removed) {
      this._revision += 1;
      this._updatedAt = new Date().toISOString();
      this.emit('serverChanged', { action: 'remove', id: String(id) });
    }
    return removed;
  }

  get(id) {
    return this._servers.get(String(id)) || null;
  }

  list({ kind, enabledOnly = true, tag } = {}) {
    return [...this._servers.values()].filter((server) => {
      if (enabledOnly && !server.enabled) return false;
      if (kind && server.kind !== kind) return false;
      if (tag && !server.tags.includes(tag)) return false;
      return true;
    });
  }

  snapshot() {
    return {
      revision: this._revision,
      updatedAt: this._updatedAt,
      servers: this.list({ enabledOnly: false }).map((server) => ({ ...server, metadata: { ...server.metadata } }))
    };
  }

  async health(check, options = {}) {
    if (typeof check !== 'function') throw new TypeError('health requires a check(server) function.');
    const servers = this.list(options);
    const entries = await Promise.all(servers.map(async (server) => {
      try {
        const result = await check(server);
        return { id: server.id, kind: server.kind, status: 'ok', result };
      } catch (error) {
        logger.warn(`ServerRegistry health check failed for ${server.id}: ${error.message}`);
        return { id: server.id, kind: server.kind, status: 'error', error: error.message };
      }
    }));
    return { revision: this._revision, checkedAt: new Date().toISOString(), servers: entries };
  }

  async fanOut(execute, options = {}) {
    if (typeof execute !== 'function') throw new TypeError('fanOut requires an execute(server) function.');
    const servers = this.list(options);
    const entries = await Promise.all(servers.map(async (server) => {
      try {
        return { id: server.id, kind: server.kind, status: 'ok', result: await execute(server) };
      } catch (error) {
        return { id: server.id, kind: server.kind, status: 'error', error: error.message };
      }
    }));
    return { revision: this._revision, executedAt: new Date().toISOString(), servers: entries };
  }
}

export { ServerRegistry, normalizeServer, SUPPORTED_KINDS };
export default new ServerRegistry();
