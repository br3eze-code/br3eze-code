import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(path.join(process.cwd(), 'package.json'));

export class RegionalAccessError extends Error {
  constructor(message, { code = 'REGIONAL_ACCESS_ERROR', status = 502, retryable = false, cause } = {}) {
    super(message, { cause });
    this.name = 'RegionalAccessError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export class RegionalScopeError extends RegionalAccessError {
  constructor(message = 'Regional access scope is invalid') {
    super(message, { code: 'REGIONAL_SCOPE_INVALID', status: 403, retryable: false });
    this.name = 'RegionalScopeError';
  }
}

export class RegionalProviderError extends RegionalAccessError {
  constructor(message, options = {}) {
    super(message, { code: 'REGIONAL_PROVIDER_ERROR', status: 502, retryable: true, ...options });
    this.name = 'RegionalProviderError';
  }
}

export class RegionalConflictError extends RegionalAccessError {
  constructor(message) {
    super(message, { code: 'REGIONAL_CONFLICT', status: 409, retryable: false });
    this.name = 'RegionalConflictError';
  }
}

const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/;

function requireScope(context) {
  const scope = {
    tenantId: context?.tenantId,
    regionId: context?.regionId,
    siteId: context?.siteId,
    principalId: context?.principalId,
    channel: context?.channel || 'internal',
    correlationId: context?.correlationId || crypto.randomUUID(),
  };
  for (const [key, value] of Object.entries(scope)) {
    if (['channel', 'correlationId'].includes(key)) continue;
    if (typeof value !== 'string' || !SAFE_ID.test(value)) {
      throw new RegionalScopeError(`Missing or invalid ${key}`);
    }
  }
  return Object.freeze(scope);
}

function scopedKey(prefix, scope, id) {
  const parts = [prefix, scope.tenantId, scope.regionId, scope.siteId];
  if (id) parts.push(id);
  return parts.join(':');
}

async function cacheGet(cache, key) {
  if (!cache?.get) return null;
  try {
    const value = await cache.get(key);
    if (!value) return null;
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch (error) {
    cache.logger?.warn?.({ err: error, key }, 'regional cache read failed');
    return null;
  }
}

async function cacheSet(cache, key, value, ttlSeconds) {
  if (!cache?.set) return;
  try {
    const encoded = JSON.stringify(value);
    if (cache.set.length >= 3) await cache.set(key, encoded, 'EX', ttlSeconds);
    else await cache.set(key, encoded, { EX: ttlSeconds });
  } catch (error) {
    cache.logger?.warn?.({ err: error, key }, 'regional cache write failed');
  }
}

async function cacheDelete(cache, key) {
  if (!cache?.del) return;
  try { await cache.del(key); } catch (error) { cache.logger?.warn?.({ err: error, key }, 'regional cache delete failed'); }
}

export class RegionalAccessAdapter {
  constructor({ cache = null, clock = () => Date.now(), logger = console, cacheTtlSeconds = 30 } = {}) {
    this.cache = cache;
    this.clock = clock;
    this.logger = logger;
    this.cacheTtlSeconds = cacheTtlSeconds;
  }

  requireScope(context) { return requireScope(context); }

  async withProvider(operation, context, fn) {
    const scope = requireScope(context);
    try {
      return await fn(scope);
    } catch (error) {
      if (error instanceof RegionalAccessError) throw error;
      this.logger.error?.({ err: error, operation, tenantId: scope.tenantId, regionId: scope.regionId, siteId: scope.siteId, correlationId: scope.correlationId }, 'regional provider operation failed');
      throw new RegionalProviderError(`${operation} failed`, { cause: error });
    }
  }

  async cached(scope, suffix, loader, ttlSeconds = this.cacheTtlSeconds) {
    const key = scopedKey(`agentos:regional:${suffix}`, scope);
    const hit = await cacheGet(this.cache, key);
    if (hit) return { value: hit, cached: true };
    const value = await loader();
    await cacheSet(this.cache, key, value, ttlSeconds);
    return { value, cached: false };
  }

  async invalidate(scope, suffix) {
    await cacheDelete(this.cache, scopedKey(`agentos:regional:${suffix}`, scope));
  }

  async provisionUser() { throw new Error('provisionUser must be implemented by an adapter'); }
  async suspendUser() { throw new Error('suspendUser must be implemented by an adapter'); }
  async authenticateUser() { throw new Error('authenticateUser must be implemented by an adapter'); }
  async issueVoucher() { throw new Error('issueVoucher must be implemented by an adapter'); }
  async revokeVoucher() { throw new Error('revokeVoucher must be implemented by an adapter'); }
  async getUsage() { throw new Error('getUsage must be implemented by an adapter'); }
  async health() { throw new Error('health must be implemented by an adapter'); }
}

export class FreeRadiusMikrotikAdapter extends RegionalAccessAdapter {
  constructor({ radiusClient, mikrotikClient, usageStore = null, cache = null, logger = console, clock, cacheTtlSeconds = 30 } = {}) {
    super({ cache, logger, clock, cacheTtlSeconds });
    if (!radiusClient) throw new TypeError('radiusClient is required');
    if (!mikrotikClient) throw new TypeError('mikrotikClient is required');
    this.radiusClient = radiusClient;
    this.mikrotikClient = mikrotikClient;
    this.usageStore = usageStore;
  }

  async provisionUser(context, user, policy = {}) {
    return this.withProvider('radius.user.provision', context, async (scope) => {
      if (!user?.userId || !user.username || !user.password) throw new RegionalScopeError('userId, username, and password are required');
      if (!policy.rateLimit || !Number.isFinite(Number(policy.sessionTimeout))) throw new RegionalScopeError('rateLimit and sessionTimeout are required');
      const attributes = {
        UserName: user.username,
        CleartextPassword: user.password,
        'Mikrotik-Rate-Limit': String(policy.rateLimit),
        'Session-Timeout': Number(policy.sessionTimeout),
        'Acct-Interim-Interval': Number(policy.interimInterval || 300),
        'Filter-Id': `tenant:${scope.tenantId}:region:${scope.regionId}:site:${scope.siteId}`,
      };
      const result = await this.radiusClient.upsertUser(scope, attributes);
      await this.invalidate(scope, `user:${user.userId}`);
      await this.usageStore?.record?.({ ...scope, action: 'radius.user.provisioned', resourceId: user.userId });
      return { success: true, userId: user.userId, regionId: scope.regionId, siteId: scope.siteId, result };
    });
  }

  async suspendUser(context, userId, reason = 'operator_request') {
    return this.withProvider('radius.user.suspend', context, async (scope) => {
      if (typeof userId !== 'string' || !SAFE_ID.test(userId)) throw new RegionalScopeError('userId is required');
      const result = await this.radiusClient.disableUser(scope, userId, reason);
      await this.invalidate(scope, `user:${userId}`);
      await this.usageStore?.record?.({ ...scope, action: 'radius.user.suspended', resourceId: userId, reason });
      return { success: true, userId, result };
    });
  }

  async authenticateUser(context, credentials) {
    return this.withProvider('radius.user.authenticate', context, async (scope) => {
      if (!credentials?.username || !credentials.password) throw new RegionalScopeError('username and password are required');
      const key = scopedKey('auth', scope, credentials.username);
      const cached = await cacheGet(this.cache, key);
      if (cached?.status === 'authenticated' && cached.expiresAt > this.clock()) return { ...cached, cached: true };
      const result = await this.radiusClient.authenticate(scope, credentials);
      const normalized = {
        status: result?.status === 'authenticated' ? 'authenticated' : 'rejected',
        username: credentials.username,
        expiresAt: this.clock() + (Number(result?.ttlSeconds || 15) * 1000),
        attributes: result?.attributes || {},
      };
      if (normalized.status === 'authenticated') await cacheSet(this.cache, key, normalized, Math.min(Number(result?.ttlSeconds || 15), this.cacheTtlSeconds));
      return { ...normalized, cached: false };
    });
  }

  async issueVoucher(context, voucher) {
    return this.withProvider('radius.voucher.issue', context, async (scope) => {
      if (!voucher?.voucherId || !voucher.code) throw new RegionalScopeError('voucherId and code are required');
      const result = await this.radiusClient.issueVoucher(scope, voucher);
      await this.usageStore?.record?.({ ...scope, action: 'radius.voucher.issued', resourceId: voucher.voucherId });
      return { success: true, voucherId: voucher.voucherId, result };
    });
  }

  async revokeVoucher(context, voucherId) {
    return this.withProvider('radius.voucher.revoke', context, async (scope) => {
      if (typeof voucherId !== 'string' || !SAFE_ID.test(voucherId)) throw new RegionalScopeError('voucherId is required');
      const result = await this.radiusClient.revokeVoucher(scope, voucherId);
      await this.usageStore?.record?.({ ...scope, action: 'radius.voucher.revoked', resourceId: voucherId });
      return { success: true, voucherId, result };
    });
  }

  async getUsage(context, userId, range = {}) {
    return this.withProvider('radius.usage.read', context, async (scope) => {
      if (typeof userId !== 'string' || !SAFE_ID.test(userId)) throw new RegionalScopeError('userId is required');
      const result = await this.cached(scope, `usage:${userId}`, () => this.radiusClient.getUsage(scope, userId, range), 10);
      return { userId, usage: result.value, cached: result.cached };
    });
  }

  async health(context) {
    return this.withProvider('regional.health', context, async (scope) => {
      const [radius, mikrotik] = await Promise.all([
        this.radiusClient.health(scope),
        this.mikrotikClient.health(scope),
      ]);
      return { healthy: Boolean(radius?.healthy && mikrotik?.healthy), regionId: scope.regionId, siteId: scope.siteId, radius, mikrotik };
    });
  }

  async getRouterStatus(context) {
    return this.withProvider('mikrotik.status.read', context, async (scope) => {
      const result = await this.cached(scope, 'router-status', () => this.mikrotikClient.getStatus(scope), 5);
      return { status: result.value, cached: result.cached };
    });
  }

  async disconnectUser(context, sessionId, reason = 'operator_request') {
    return this.withProvider('mikrotik.session.disconnect', context, async (scope) => {
      if (typeof sessionId !== 'string' || !SAFE_ID.test(sessionId)) throw new RegionalScopeError('sessionId is required');
      const result = await this.mikrotikClient.disconnectSession(scope, sessionId, reason);
      await this.usageStore?.record?.({ ...scope, action: 'mikrotik.session.disconnected', resourceId: sessionId, reason });
      return { success: true, sessionId, result };
    });
  }
}

export function createRedisCache({ url = process.env.REDIS_URL, redis, logger = console } = {}) {
  if (redis) return redis;
  if (!url) return null;
  return new (requireRedis())(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false, keyPrefix: '' ,
    retryStrategy: () => null,
  });
}

function requireRedis() {
  // ioredis is an ESM-compatible default export in the repository's Node runtime.
  // Kept behind a function so tests can inject a fake cache without connecting.
  // eslint-disable-next-line global-require
  return require('ioredis');
}

export function assertRegionalScope(context) { return requireScope(context); }
export { scopedKey };

export default FreeRadiusMikrotikAdapter;
