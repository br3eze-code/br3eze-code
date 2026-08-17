const HEALTH_CAPABILITY = 'router.health.read';
const DEFAULT_MAX_TARGETS = 50;
const DEFAULT_CONCURRENCY = 8;

function required(value, name) {
  if (value == null || value === '') throw new TypeError(`${name} is required`);
  return String(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class HealthTargetRegistry {
  constructor() {
    this.tenants = new Map();
    this.sites = new Map();
    this.routers = new Map();
    this.memberships = new Map();
  }

  addTenant({ tenantId, name }) {
    const id = required(tenantId, 'tenantId');
    this.tenants.set(id, Object.freeze({ tenantId: id, name: name || id }));
    return this.tenants.get(id);
  }

  addSite({ tenantId, siteId, name }) {
    const tenant = required(tenantId, 'tenantId');
    const site = required(siteId, 'siteId');
    if (!this.tenants.has(tenant)) throw new Error('tenant not found');
    const record = Object.freeze({ tenantId: tenant, siteId: site, name: name || site });
    this.sites.set(`${tenant}:${site}`, record);
    return record;
  }

  addRouter({ tenantId, siteId, routerId, adapterType }) {
    const tenant = required(tenantId, 'tenantId');
    const site = required(siteId, 'siteId');
    const router = required(routerId, 'routerId');
    if (!this.sites.has(`${tenant}:${site}`)) throw new Error('site not found');
    const record = Object.freeze({ tenantId: tenant, siteId: site, routerId: router, adapterType: required(adapterType, 'adapterType'), status: 'enrolled' });
    this.routers.set(`${tenant}:${site}:${router}`, record);
    return record;
  }

  grantSiteMembership({ principalId, tenantId, siteId, capabilities = [HEALTH_CAPABILITY] }) {
    const principal = required(principalId, 'principalId');
    const tenant = required(tenantId, 'tenantId');
    const site = required(siteId, 'siteId');
    if (!this.sites.has(`${tenant}:${site}`)) throw new Error('site not found');
    this.memberships.set(`${principal}:${tenant}:${site}`, Object.freeze({ principalId: principal, tenantId: tenant, siteId: site, capabilities: [...capabilities] }));
  }

  resolveTargets({ principalId, tenantId = null, siteIds = [], routerIds = [] }) {
    const principal = required(principalId, 'principalId');
    const memberships = [...this.memberships.values()].filter((membership) => membership.principalId === principal && (!tenantId || membership.tenantId === tenantId));
    if (memberships.length === 0) throw new Error('principal has no authorized site membership');
    const permitted = memberships.filter((membership) => membership.capabilities.includes(HEALTH_CAPABILITY));
    if (permitted.length === 0) throw new Error('principal lacks router health capability');
    const selectedSites = new Set(siteIds.map(String));
    const selectedRouters = new Set(routerIds.map(String));
    const targets = [...this.routers.values()].filter((router) => permitted.some((membership) => membership.tenantId === router.tenantId && membership.siteId === router.siteId) && (!tenantId || router.tenantId === tenantId) && (selectedSites.size === 0 || selectedSites.has(router.siteId)) && (selectedRouters.size === 0 || selectedRouters.has(router.routerId)));
    if (tenantId === null && selectedSites.size === 0 && selectedRouters.size === 0 && new Set(permitted.map((membership) => membership.tenantId)).size > 1) {
      throw new Error('roaming principal must select a tenant or explicit sites/routers');
    }
    return targets.map(clone);
  }
}

export class HealthCheckOrchestrator {
  constructor({ targetRegistry, adapters = new Map(), concurrency = DEFAULT_CONCURRENCY, maxTargets = DEFAULT_MAX_TARGETS, now = () => new Date() } = {}) {
    if (!targetRegistry) throw new TypeError('targetRegistry is required');
    this.targetRegistry = targetRegistry;
    this.adapters = adapters;
    this.concurrency = Math.max(1, Number(concurrency));
    this.maxTargets = Math.max(1, Number(maxTargets));
    this.now = now;
  }

  async check({ principalId, tenantId = null, siteIds = [], routerIds = [], source = 'telegram', correlationId, workId, loopId }) {
    required(correlationId, 'correlationId');
    required(workId, 'workId');
    required(loopId, 'loopId');
    if (!['telegram', 'whatsapp', 'pwa', 'system-poll'].includes(source)) throw new Error('unsupported health-check source');
    const targets = this.targetRegistry.resolveTargets({ principalId, tenantId, siteIds, routerIds });
    if (targets.length > this.maxTargets) throw new Error(`health-check target limit exceeded: ${this.maxTargets}`);
    const evidence = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const target = targets[cursor++];
        const adapter = this.adapters.get(target.adapterType);
        if (!adapter || typeof adapter.checkHealth !== 'function') {
          evidence.push({ target, status: 'unavailable', reason: 'adapter unavailable' });
          continue;
        }
        const scope = Object.freeze({ tenantId: target.tenantId, siteId: target.siteId, routerId: target.routerId, principalId, capability: HEALTH_CAPABILITY, correlationId, workId, loopId });
        try {
          const observation = await adapter.checkHealth(scope);
          evidence.push({ target, status: 'observed', observation: clone(observation), occurredAt: this.now().toISOString() });
        } catch (error) {
          evidence.push({ target, status: 'failed', reason: error instanceof Error ? error.message : 'adapter failure', occurredAt: this.now().toISOString() });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, Math.max(targets.length, 1)) }, worker));
    return Object.freeze({ source, tenantId, principalId, capability: HEALTH_CAPABILITY, targetCount: targets.length, evidence: evidence.sort((a, b) => `${a.target.tenantId}:${a.target.siteId}:${a.target.routerId}`.localeCompare(`${b.target.tenantId}:${b.target.siteId}:${b.target.routerId}`)), correlationId, workId, loopId });
  }
}

export class HealthPollingCoordinator {
  constructor({ checker, maxInFlightPerTenant = 1 } = {}) {
    if (!checker || typeof checker.check !== 'function') throw new TypeError('checker is required');
    this.checker = checker;
    this.maxInFlightPerTenant = Math.max(1, Number(maxInFlightPerTenant));
    this.tenantInFlight = new Map();
  }

  async poll(request) {
    const tenantId = required(request.tenantId, 'tenantId');
    const inFlight = this.tenantInFlight.get(tenantId) || 0;
    if (inFlight >= this.maxInFlightPerTenant) return { status: 'deferred', tenantId, reason: 'tenant poll already in flight' };
    this.tenantInFlight.set(tenantId, inFlight + 1);
    try {
      const result = await this.checker.check({ ...request, tenantId, source: request.source || 'system-poll' });
      return { status: 'completed', tenantId, result };
    } finally {
      const remaining = (this.tenantInFlight.get(tenantId) || 1) - 1;
      if (remaining === 0) this.tenantInFlight.delete(tenantId);
      else this.tenantInFlight.set(tenantId, remaining);
    }
  }
}

export { HEALTH_CAPABILITY, DEFAULT_MAX_TARGETS, DEFAULT_CONCURRENCY };
export default HealthCheckOrchestrator;
