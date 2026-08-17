import crypto from 'node:crypto';

function createError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeTarget(target) {
  if (!target?.tenantId || !target.siteId || !target.nodeId) {
    throw createError('Fleet target requires tenantId, siteId, and nodeId', 'FLEET_TARGET_INVALID');
  }
  return {
    tenantId: target.tenantId,
    projectId: target.projectId || null,
    meshGroupId: target.meshGroupId || null,
    siteId: target.siteId,
    nodeId: target.nodeId,
    nodeType: target.nodeType || 'router'
  };
}

function withTimeout(promise, timeoutMs, target) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(createError(`Health poll timed out for ${target.nodeId}`, 'FLEET_POLL_TIMEOUT')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class FleetHealthPoller {
  constructor({
    listTargets,
    pollTarget,
    snapshotStore = null,
    notificationHub = null,
    maxConcurrency = 25,
    timeoutMs = 10000,
    leaseMs = 30000,
    alertCooldownMs = 300000,
    now = () => Date.now(),
    idFactory = () => `fleet_poll_${crypto.randomUUID()}`
  } = {}) {
    if (typeof listTargets !== 'function') throw new TypeError('listTargets is required');
    if (typeof pollTarget !== 'function') throw new TypeError('pollTarget is required');
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) throw new TypeError('maxConcurrency must be a positive integer');
    this.listTargets = listTargets;
    this.pollTarget = pollTarget;
    this.snapshotStore = snapshotStore;
    this.notificationHub = notificationHub;
    this.maxConcurrency = maxConcurrency;
    this.timeoutMs = timeoutMs;
    this.leaseMs = leaseMs;
    this.alertCooldownMs = alertCooldownMs;
    this.now = now;
    this.idFactory = idFactory;
    this.leases = new Map();
    this.aggregateState = new Map();
  }

  _eligibleTargets(targets, { tenantId, siteIds = [], nodeIds = [] } = {}) {
    const sites = new Set(siteIds);
    const nodes = new Set(nodeIds);
    return targets
      .map(normalizeTarget)
      .filter((target) => target.tenantId === tenantId)
      .filter((target) => sites.size === 0 || sites.has(target.siteId))
      .filter((target) => nodes.size === 0 || nodes.has(target.nodeId));
  }

  _acquireLease(target, pollId) {
    const key = `${target.tenantId}:${target.nodeId}`;
    const existing = this.leases.get(key);
    const now = this.now();
    if (existing && existing.expiresAt > now) return null;
    this.leases.set(key, { pollId, expiresAt: now + this.leaseMs });
    return () => {
      const current = this.leases.get(key);
      if (current?.pollId === pollId) this.leases.delete(key);
    };
  }

  async _saveSnapshot(snapshot) {
    if (typeof this.snapshotStore === 'function') return this.snapshotStore(snapshot);
    if (this.snapshotStore?.save) return this.snapshotStore.save(snapshot);
    return undefined;
  }

  _publishAggregate(target, snapshot) {
    const key = `${target.tenantId}:${target.siteId}`;
    const current = this.aggregateState.get(key) || { states: new Map(), lastAlertAt: 0, lastDominantState: null };
    current.states.set(target.nodeId, snapshot.status);
    const counts = Object.fromEntries([...new Set(current.states.values())].map((status) => [status, [...current.states.values()].filter((value) => value === status).length]));
    const dominantState = [...current.states.entries()].reduce((best, [, state]) => {
      if (!best) return state;
      return (counts[state] || 0) > (counts[best] || 0) ? state : best;
    }, null);
    const changed = dominantState !== current.lastDominantState;
    const cooldownElapsed = this.now() - current.lastAlertAt >= this.alertCooldownMs;
    const shouldPublish = changed || (dominantState !== 'online' && cooldownElapsed);
    current.lastDominantState = dominantState;
    if (shouldPublish) {
      current.lastAlertAt = this.now();
      this.notificationHub?.publish?.({
        eventId: `fleet_aggregate_${key}`,
        type: 'fleet.site.health.aggregate',
        severity: dominantState === 'online' ? 'info' : 'warning',
        tenantId: target.tenantId,
        meshGroupId: target.meshGroupId,
        siteId: target.siteId,
        dominantState,
        counts,
        representativeNodeId: target.nodeId,
        occurredAt: new Date(this.now()).toISOString()
      });
    }
    this.aggregateState.set(key, current);
  }

  async _pollOne(target, context, pollId) {
    const release = this._acquireLease(target, pollId);
    if (!release) return { target, status: 'skipped', reason: 'lease-held' };
    const startedAt = this.now();
    try {
      const result = await withTimeout(Promise.resolve(this.pollTarget(target, context)), this.timeoutMs, target);
      const snapshot = {
        snapshotId: `${pollId}:${target.nodeId}`,
        pollId,
        ...target,
        status: result?.status || 'online',
        observedAt: new Date(this.now()).toISOString(),
        latencyMs: this.now() - startedAt,
        metrics: result?.metrics || {},
        error: null
      };
      await this._saveSnapshot(snapshot);
      this._publishAggregate(target, snapshot);
      return snapshot;
    } catch (error) {
      const snapshot = {
        snapshotId: `${pollId}:${target.nodeId}`,
        pollId,
        ...target,
        status: 'offline',
        observedAt: new Date(this.now()).toISOString(),
        latencyMs: this.now() - startedAt,
        metrics: {},
        error: { code: error.code || 'FLEET_POLL_FAILED', message: error.message }
      };
      await this._saveSnapshot(snapshot);
      this._publishAggregate(target, snapshot);
      return snapshot;
    } finally {
      release();
    }
  }

  async poll({ tenantId, principalId, siteIds = [], nodeIds = [], context = {} } = {}) {
    if (!tenantId) throw createError('tenantId is required', 'FLEET_TENANT_REQUIRED');
    const pollId = this.idFactory();
    const targets = this._eligibleTargets(await this.listTargets({ tenantId, principalId, context }), { tenantId, siteIds, nodeIds });
    const results = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const target = targets[cursor++];
        results.push(await this._pollOne(target, { ...context, tenantId, principalId }, pollId));
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.maxConcurrency, Math.max(targets.length, 1)) }, worker));
    return {
      pollId,
      tenantId,
      targetCount: targets.length,
      completedCount: results.filter((result) => result.status !== 'skipped').length,
      skippedCount: results.filter((result) => result.status === 'skipped').length,
      onlineCount: results.filter((result) => result.status === 'online').length,
      offlineCount: results.filter((result) => result.status === 'offline').length,
      results
    };
  }
}

export default FleetHealthPoller;
