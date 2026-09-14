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

export class MikroTikMeshRegistry extends EventEmitter {
  constructor({ managerFactory = createManager, auditSink = null, readOnlyTools = DEFAULT_READ_ONLY_TOOLS } = {}) {
    super(); this.managerFactory = managerFactory; this.auditSink = auditSink; this.readOnlyTools = new Set(readOnlyTools); this.sites = new Map();
  }
  register(site = {}) {
    const id = site.id || site.routerId;
    if (!id || typeof id !== 'string') throw new TypeError('A stable site id is required');
    if (!site.host && !site.ip) throw new TypeError(`Site ${id} requires a host or IP`);
    if (this.sites.has(id)) throw new Error(`Site already registered: ${id}`);
    const managerConfig = { host: site.host || site.ip, port: site.port || 8728, user: site.user, password: site.password, timeout: site.timeout || 10000, tls: site.tls === true, tenantId: site.tenantId || null, siteId: id, domain: 'network' };
    this.sites.set(id, { id, name: site.name || id, tenantId: site.tenantId || null, overlay: site.overlay || null, managerConfig, manager: null, status: 'registered', lastError: null, lastSeenAt: null });
    return this.describe(id);
  }
  describe(id) { const s = this.sites.get(id); return s ? { id: s.id, name: s.name, tenantId: s.tenantId, overlay: s.overlay, host: s.managerConfig.host, port: s.managerConfig.port, status: s.status, lastError: s.lastError, lastSeenAt: s.lastSeenAt } : null; }
  list({ tenantId } = {}) { return [...this.sites.values()].filter(s => !tenantId || s.tenantId === tenantId).map(s => this.describe(s.id)); }
  _authorize(site, context = {}) { if (!site) throw new Error('Unknown mesh site'); if (context.tenantId && site.tenantId && site.tenantId !== context.tenantId) throw new Error('Site is outside the tenant boundary'); if (!context.allowFleet && context.authorizedSiteIds?.length && !context.authorizedSiteIds.includes(site.id)) throw new Error(`Site access denied: ${site.id}`); }
  async connect(id, context = {}) { const s = this.sites.get(id); this._authorize(s, context); if (s.manager?.isConnected) return this.describe(id); try { s.manager = this.managerFactory(s.managerConfig); await s.manager.connect(); s.status = 'online'; s.lastError = null; s.lastSeenAt = new Date().toISOString(); return this.describe(id); } catch (e) { s.status = 'offline'; s.lastError = e.message; throw e; } }
  async execute(id, tool, params = {}, context = {}) { const s = this.sites.get(id); this._authorize(s, context); if (!tool) throw new TypeError('A tool name is required'); if (!this.readOnlyTools.has(tool) && context.confirmed !== true) { const e = new Error(`Confirmation required for mutating tool: ${tool}`); e.code = 'MESH_CONFIRMATION_REQUIRED'; throw e; } if (!s.manager) await this.connect(id, context); const startedAt = Date.now(); try { const result = await s.manager.executeTool(tool, params); await this._audit({ action: 'execute', siteId: id, tenantId: s.tenantId, tool, context, ok: true, durationMs: Date.now() - startedAt }); return { siteId: id, tool, result }; } catch (e) { await this._audit({ action: 'execute', siteId: id, tenantId: s.tenantId, tool, context, ok: false, error: e.message, durationMs: Date.now() - startedAt }); throw e; } }
  async executeFleet(siteIds, tool, params = {}, context = {}) { if (context.allowFleet !== true) throw new Error('Fleet execution requires explicit allowFleet=true'); return Promise.allSettled(siteIds.map(id => this.execute(id, tool, params, { ...context, allowFleet: true }))); }
  async health(siteIds, context = {}) { const ids = siteIds || this.list({ tenantId: context.tenantId }).map(s => s.id); return Promise.all(ids.map(async id => { try { await this.connect(id, context); return { siteId: id, status: 'online', site: this.describe(id) }; } catch (e) { return { siteId: id, status: 'offline', error: e.message, site: this.describe(id) }; } })); }
  async remove(id, context = {}) { const s = this.sites.get(id); this._authorize(s, context); await s?.manager?.destroy?.(); this.sites.delete(id); }
  async _audit(event) { const safe = { ...event, context: this._redact(event.context) }; this.emit('audit', safe); if (this.auditSink) await this.auditSink(safe); }
  _redact(value) { if (!value || typeof value !== 'object') return value; return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sensitive.test(k) ? '[REDACTED]' : v])); }
  async destroy() { await Promise.allSettled([...this.sites.values()].map(s => s.manager?.destroy?.())); this.sites.clear(); }
}
export default MikroTikMeshRegistry;
