import express from 'express';
import request from 'supertest';
import { createRegionalAccessRouter } from '../../src/routes/regional-access.js';
import { FreeRadiusMikrotikAdapter, RegionalProviderError } from '../../src/core/regional-access-adapter.js';

function fakeCache() {
  const values = new Map();
  return {
    async get(key) { return values.get(key) || null; },
    async set(key, value) { values.set(key, value); },
    async del(key) { values.delete(key); },
  };
}

function buildApp({ user, adapter }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.firebaseUser = user; next(); });
  app.use('/api/v1/regional', createRegionalAccessRouter({ adapter, logger: { error() {} } }));
  return app;
}

function adapterFixture() {
  const calls = { upsert: [], auth: [], disable: [] };
  const radiusClient = {
    async upsertUser(scope, attrs) { calls.upsert.push({ scope, attrs }); return { provider: 'regional-radius' }; },
    async disableUser(scope, userId, reason) { calls.disable.push({ scope, userId, reason }); return { provider: 'regional-radius' }; },
    async authenticate(scope, credentials) { calls.auth.push({ scope, credentials }); return { status: 'authenticated', ttlSeconds: 60, attributes: { 'Mikrotik-Rate-Limit': '20M/20M' } }; },
    async getUsage() { return { bytesIn: 10, bytesOut: 20 }; },
    async health() { return { healthy: true }; },
  };
  const mikrotikClient = { async health() { return { healthy: true }; } };
  return { adapter: new FreeRadiusMikrotikAdapter({ radiusClient, mikrotikClient, cache: fakeCache(), usageStore: { record: async () => {} } }), calls };
}

const baseUser = { uid: 'principal-1', tenantId: 'tenant-1', regionId: 'west', siteId: 'site-1', role: 'admin' };
const params = '/api/v1/regional/tenants/tenant-1/regions/west/sites/site-1';

describe('regional access API', () => {
  test('provisions a user with tenant, region, and site-scoped attributes', async () => {
    const fixture = adapterFixture();
    const res = await request(buildApp({ user: baseUser, adapter: fixture.adapter }))
      .post(`${params}/users/provision`)
      .send({ user: { userId: 'user-1', username: 'alice', password: 'not-returned' }, policy: { rateLimit: '20M/20M', sessionTimeout: 3600 } });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(fixture.calls.upsert[0].attrs['Filter-Id']).toBe('tenant:tenant-1:region:west:site:site-1');
    expect(fixture.calls.upsert[0].attrs.CleartextPassword).toBe('not-returned');
  });

  test('rejects a cross-tenant request without revealing provider resources', async () => {
    const fixture = adapterFixture();
    const res = await request(buildApp({ user: baseUser, adapter: fixture.adapter }))
      .post('/api/v1/regional/tenants/tenant-2/regions/west/sites/site-1/users/provision')
      .send({ user: { userId: 'user-1', username: 'alice', password: 'x' }, policy: { rateLimit: '20M/20M', sessionTimeout: 3600 } });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not available/i);
    expect(fixture.calls.upsert).toHaveLength(0);
  });

  test('rejects a cross-site request for a site-bound principal', async () => {
    const fixture = adapterFixture();
    const res = await request(buildApp({ user: baseUser, adapter: fixture.adapter }))
      .post('/api/v1/regional/tenants/tenant-1/regions/west/sites/site-2/users/provision')
      .send({ user: { userId: 'user-1', username: 'alice', password: 'x' }, policy: { rateLimit: '20M/20M', sessionTimeout: 3600 } });

    expect(res.status).toBe(404);
    expect(fixture.calls.upsert).toHaveLength(0);
  });

  test('authenticates through the regional proxy and caches only successful decisions', async () => {
    const fixture = adapterFixture();
    const app = buildApp({ user: { ...baseUser, role: 'viewer' }, adapter: fixture.adapter });
    const first = await request(app).post(`${params}/users/authenticate`).send({ username: 'alice', password: 'secret' });
    const second = await request(app).post(`${params}/users/authenticate`).send({ username: 'alice', password: 'secret' });

    expect(first.status).toBe(200);
    expect(first.body.cached).toBe(false);
    expect(second.body.cached).toBe(true);
    expect(fixture.calls.auth).toHaveLength(1);
  });

  test('suspends a user only for a management role', async () => {
    const fixture = adapterFixture();
    const denied = await request(buildApp({ user: { ...baseUser, role: 'viewer' }, adapter: fixture.adapter }))
      .post(`${params}/users/user-1/suspend`).send({ reason: 'billing' });
    const allowed = await request(buildApp({ user: baseUser, adapter: fixture.adapter }))
      .post(`${params}/users/user-1/suspend`).send({ reason: 'billing' });

    expect(denied.status).toBe(403);
    expect(allowed.status).toBe(200);
    expect(fixture.calls.disable).toHaveLength(1);
  });

  test('maps provider failures to a retryable bounded response', async () => {
    const adapter = { async health() { throw new RegionalProviderError('radius unavailable'); } };
    const res = await request(buildApp({ user: { ...baseUser, role: 'viewer' }, adapter }))
      .get(`${params}/health`);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('REGIONAL_PROVIDER_ERROR');
    expect(res.body.retryable).toBe(true);
  });
});
