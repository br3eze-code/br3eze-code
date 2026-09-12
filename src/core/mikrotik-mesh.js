import EventEmitter from 'node:events';

/**
 * Domain-neutral multi-node registry.
 * Concrete device/network behavior is supplied by managerFactory at the
 * composition boundary. The kernel/core must not know vendor protocols.
 */
export class MeshRegistry extends EventEmitter {
  constructor({ managerFactory = null, auditSink = null, readOnlyTools = [] } = {}) {
    super();
    this.managerFactory = managerFactory;
    this.auditSink = auditSink;
    this.readOnlyTools = new Set(readOnlyTools);
    this.sites = new Map();
  }

  register(site = {}) {
    const id = site.id;
    if (!id || typeof id !== 'string') throw new TypeError('A stable node id is required');
    if (this.sites.has(id)) throw new Error(`Node already registered: ${id}`);
    this.sites.set(id, {
      id,
      name: site.name || id,
      tenantId: site.tenantId || null,
      scope: site.scope || null,
      config: site.config || {},
      manager: null,
      status: 'registered',
      lastError: null,
      lastSeenAt: null,
    });
    return this.describe(id);
  }

  describe(id) {
    const node = this.sites.get(id);
    if (!node) return null;
    return {
      id: node.id,
      name: node.name,
      tenantId: node.tenantId,
      scope: node.scope,
      status: node.status,
      lastError: node.lastError,
      lastSeenAt: node.lastSeenAt,
    };
  }

  list({ tenantId } = {}) {
    return [...this.sites.values()]
      .filter((node) => !tenantId || node.tenantId === tenantId)
      .map((node) => this.describe(node.id));
  }

  _authorize(node, { tenantId, authorizedNodeIds = [], allowFleet = false } = {}) {
    if (!node) throw new Error('Unknown node');
    if (tenantId && node.tenantId && node.tenantId !== tenantId) {
      throw new Error('Node is outside the tenant boundary');
    }
    if (!allowFleet && authorizedNodeIds.length > 0 && !authorizedNodeIds.includes(node.id)) {
      throw new Error(`Node access denied: ${node.id}`);
    }
  }

  async connect(id, context = {}) {
    const node = this.sites.get(id);
    this._authorize(node, context);
    if (!this.managerFactory) throw new Error('No node manager adapter configured');
    if (node.manager?.state?.isConnected) return this.describe(id);
    try {
      node.manager = await this.managerFactory(node.config, { node: this.describe(id), context });
      await node.manager.connect?.();
      node.status = 'online';
      node.lastError = null;
      node.lastSeenAt = new Date().toISOString();
      return this.describe(id);
    } catch (error) {
      node.status = 'offline';
      node.lastError = error.message;
      throw error;
    }
  }

  async execute(id, capability, params = {}, context = {}) {
    const node = this.sites.get(id);
    this._authorize(node, context);
    if (typeof capability !== 'string' || !capability) throw new TypeError('A capability name is required');
    if (!this.readOnlyTools.has(capability) && context.confirmed !== true) {
      const error = new Error(`Confirmation required for mutating capability: ${capability}`);
      error.code = 'NODE_CONFIRMATION_REQUIRED';
      throw error;
    }
    if (!node.manager) await this.connect(id, context);
    const startedAt = Date.now();
    try {
      const result = await node.manager.execute?.(capability, params, context);
      await this._audit({ action: 'execute', nodeId: id, tenantId: node.tenantId, capability, ok: true, durationMs: Date.now() - startedAt });
      return { nodeId: id, capability, result };
    } catch (error) {
      await this._audit({ action: 'execute', nodeId: id, tenantId: node.tenantId, capability, ok: false, error: error.message, durationMs: Date.now() - startedAt });
      throw error;
    }
  }

  async executeFleet(nodeIds, capability, params = {}, context = {}) {
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) throw new TypeError('nodeIds must be a non-empty array');
    if (context.allowFleet !== true) throw new Error('Fleet execution requires explicit allowFleet=true');
    return Promise.allSettled(nodeIds.map((id) => this.execute(id, capability, params, { ...context, allowFleet: true })));
  }

  async health(nodeIds, context = {}) {
    const ids = nodeIds || this.list({ tenantId: context.tenantId }).map((node) => node.id);
    return Promise.all(ids.map(async (id) => {
      try {
        await this.connect(id, context);
        return { nodeId: id, status: 'online', node: this.describe(id) };
      } catch (error) {
        return { nodeId: id, status: 'offline', error: error.message, node: this.describe(id) };
      }
    }));
  }

  async remove(id, context = {}) {
    const node = this.sites.get(id);
    this._authorize(node, context);
    try { await node?.manager?.destroy?.(); } finally { this.sites.delete(id); }
  }

  async _audit(event) {
    this.emit('audit', event);
    if (this.auditSink) await this.auditSink(event);
  }

  async destroy() {
    await Promise.allSettled([...this.sites.values()].map((node) => node.manager?.destroy?.()));
    this.sites.clear();
  }
}

export default MeshRegistry;
