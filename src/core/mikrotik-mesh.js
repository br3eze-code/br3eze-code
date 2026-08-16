import EventEmitter from 'node:events';
import { createManager } from './mikrotik.js';

const DEFAULT_READ_ONLY_TOOLS = new Set([
  'system.resources', 'system.uptime', 'system.identity', 'system.health', 'system.logs',
  'ping', 'traceroute', 'bandwidth', 'ip.addresses', 'ip.routes', 'dns', 'dhcp.leases',
  'interface.list', 'arp.table', 'system.neighbors', 'firewall.list', 'firewall.summary',
  'firewall.connections', 'nat.list', 'wireless.interfaces', 'wireless.monitor',
  'wireless.scan', 'wireless.frequency_usage', 'system.full_stats',
]);

const sensitive = /password|secret|token|private[-_]?key|credential|authorization|api[-_]?key/i;

/**
 * Multi-site MikroTik control plane.
 *
 * Routers should be reachable only over a private WireGuard/overlay address or
 * through a customer-managed edge gateway. Telegram and model agents call this
 * registry; they never receive router credentials or connect directly.
 */
export class MikroTikMeshRegistry extends EventEmitter {
  constructor({ managerFactory = createManager, auditSink = null, readOnlyTools = DEFAULT_READ_ONLY_TOOLS } = {}) {
    super();
    this.managerFactory = managerFactory;
    this.auditSink = auditSink;
    this.readOnlyTools = new Set(readOnlyTools);
    this.sites = new Map();
  }

  register(site = {}) {
    const id = site.id || site.routerId;
    if (!id || typeof id !== 'string') throw new TypeError('A stable site id is required');
    if (!site.host && !site.ip) throw new TypeError(`Site ${id} requires a private overlay host or IP`);
    if (site.publicAddress || site.publicPort) throw new Error('Direct public router exposure is not supported');
    if (this.sites.has(id)) throw new Error(`Site already registered: ${id}`);

    const managerConfig = {
      host: site.host || site.ip,
      port: site.port || 8729,
      user: site.user,
      password: site.password,
      timeout: site.timeout || 10000,
      tls: site.tls !== false,
    };
    this.sites.set(id, {
      id,
      name: site.name || id,
      tenantId: site.tenantId,
      subnet: site.subnet,
      overlay: site.overlay || 'wireguard',
      managerConfig,
      manager: null,
      status: 'registered',
      lastError: null,
      lastSeenAt: null,
    });
    return this.describe(id);
  }

  describe(id) {
    const site = this.sites.get(id);
    if (!site) return null;
    return {
      id: site.id,
      name: site.name,
      tenantId: site.tenantId,
      subnet: site.subnet,
      overlay: site.overlay,
      host: site.managerConfig.host,
      port: site.managerConfig.port,
      status: site.status,
      lastError: site.lastError,
      lastSeenAt: site.lastSeenAt,
    };
  }

  list({ tenantId } = {}) {
    return [...this.sites.values()]
      .filter((site) => !tenantId || site.tenantId === tenantId)
      .map((site) => this.describe(site.id));
  }

  _authorize(site, { tenantId, authorizedSiteIds = [], allowFleet = false } = {}) {
    if (!site) throw new Error('Unknown mesh site');
    if (tenantId && site.tenantId && site.tenantId !== tenantId) throw new Error('Site is outside the tenant boundary');
    if (!allowFleet && authorizedSiteIds.length > 0 && !authorizedSiteIds.includes(site.id)) {
      throw new Error(`Site access denied: ${site.id}`);
    }
  }

  async connect(id, context = {}) {
    const site = this.sites.get(id);
    this._authorize(site, context);
    if (site.manager?.state?.isConnected) return this.describe(id);
    try {
      site.manager = this.managerFactory(site.managerConfig);
      await site.manager.connect();
      site.status = 'online';
      site.lastError = null;
      site.lastSeenAt = new Date().toISOString();
      return this.describe(id);
    } catch (error) {
      site.status = 'offline';
      site.lastError = error.message;
      throw error;
    }
  }

  async execute(id, tool, params = {}, context = {}) {
    const site = this.sites.get(id);
    this._authorize(site, context);
    if (typeof tool !== 'string' || !tool) throw new TypeError('A tool name is required');
    if (!this.readOnlyTools.has(tool) && context.confirmed !== true) {
      const error = new Error(`Confirmation required for mutating tool: ${tool}`);
      error.code = 'MESH_CONFIRMATION_REQUIRED';
      throw error;
    }
    if (!site.manager) await this.connect(id, context);
    const startedAt = Date.now();
    try {
      const result = await site.manager.executeTool(tool, params);
      await this._audit({ action: 'execute', siteId: id, tenantId: site.tenantId, tool, context, ok: true, durationMs: Date.now() - startedAt });
      return { siteId: id, tool, result };
    } catch (error) {
      await this._audit({ action: 'execute', siteId: id, tenantId: site.tenantId, tool, context, ok: false, error: error.message, durationMs: Date.now() - startedAt });
      throw error;
    }
  }

  async executeFleet(siteIds, tool, params = {}, context = {}) {
    if (!Array.isArray(siteIds) || siteIds.length === 0) throw new TypeError('siteIds must be a non-empty array');
    if (context.allowFleet !== true) throw new Error('Fleet execution requires explicit allowFleet=true');
    return Promise.allSettled(siteIds.map((id) => this.execute(id, tool, params, { ...context, allowFleet: true })));
  }

  async health(siteIds, context = {}) {
    const ids = siteIds || this.list({ tenantId: context.tenantId }).map((site) => site.id);
    return Promise.all(ids.map(async (id) => {
      try {
        await this.connect(id, context);
        return { siteId: id, status: 'online', site: this.describe(id) };
      } catch (error) {
        return { siteId: id, status: 'offline', error: error.message, site: this.describe(id) };
      }
    }));
  }

  async remove(id, context = {}) {
    const site = this.sites.get(id);
    this._authorize(site, context);
    try { await site?.manager?.destroy?.(); } finally { this.sites.delete(id); }
  }

  async _audit(event) {
    const safe = { ...event, context: this._redact(event.context) };
    this.emit('audit', safe);
    if (this.auditSink) await this.auditSink(safe);
  }

  _redact(value) {
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitive.test(key) ? '[REDACTED]' : item]));
  }

  async destroy() {
    await Promise.allSettled([...this.sites.values()].map((site) => site.manager?.destroy?.()));
    this.sites.clear();
  }
}

export default MikroTikMeshRegistry;
