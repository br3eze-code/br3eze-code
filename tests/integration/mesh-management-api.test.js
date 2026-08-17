import express from 'express';
import request from 'supertest';
import { describe, expect, test, beforeEach } from '@jest/globals';
import { MeshManagementStore } from '../../src/core/mesh-management-store.js';
import { createMeshManagementRouter } from '../../src/routes/mesh-management.js';

function makeApp(identity, store) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.firebaseUser = identity; next(); });
  app.use('/api/v1/mesh', createMeshManagementRouter({ store }));
  return app;
}

describe('Mesh management API tenant and site isolation', () => {
  let store;
  const ownerA = { uid: 'owner-a', tenantId: 'tenant-a', role: 'owner' };
  const ownerB = { uid: 'owner-b', tenantId: 'tenant-b', role: 'owner' };

  beforeEach(() => { store = new MeshManagementStore(); });

  test('requires a verified identity and ignores untrusted tenant headers', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/mesh', createMeshManagementRouter({ store }));
    const response = await request(app).get('/api/v1/mesh/tenants/tenant-a/mesh-groups').set('x-agentos-tenant-id', 'tenant-a');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('IDENTITY_REQUIRED');
  });

  test('creates a group, site, and node within one tenant scope', async () => {
    const app = makeApp(ownerA, store);
    const groupResponse = await request(app)
      .post('/api/v1/mesh/tenants/tenant-a/mesh-groups')
      .set('Idempotency-Key', 'group-1')
      .send({ meshKey: 'nairobi-core', displayName: 'Nairobi Core' });
    expect(groupResponse.status).toBe(201);
    const group = groupResponse.body.data;

    const siteResponse = await request(app)
      .post(`/api/v1/mesh/tenants/tenant-a/mesh-groups/${group.meshGroupId}/sites`)
      .send({ siteKey: 'nbo-hq', displayName: 'Nairobi HQ' });
    expect(siteResponse.status).toBe(201);
    const site = siteResponse.body.data;

    const nodeResponse = await request(app)
      .post(`/api/v1/mesh/tenants/tenant-a/mesh-groups/${group.meshGroupId}/sites/${site.siteId}/nodes`)
      .send({ nodeKey: 'router-1', nodeType: 'mikrotik_router', displayName: 'HQ Router' });
    expect(nodeResponse.status).toBe(201);
    expect(nodeResponse.body.data).toMatchObject({ tenantId: 'tenant-a', meshGroupId: group.meshGroupId, siteId: site.siteId, status: 'enrolling' });
  });

  test('prevents a second active mesh group for the same tenant', async () => {
    const app = makeApp(ownerA, store);
    await request(app).post('/api/v1/mesh/tenants/tenant-a/mesh-groups').send({ meshKey: 'one', displayName: 'One' });
    const response = await request(app).post('/api/v1/mesh/tenants/tenant-a/mesh-groups').send({ meshKey: 'two', displayName: 'Two' });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('MESH_GROUP_LIMIT_REACHED');
  });

  test('does not disclose another tenant mesh group', async () => {
    const appA = makeApp(ownerA, store);
    const created = await request(appA).post('/api/v1/mesh/tenants/tenant-a/mesh-groups').send({ meshKey: 'private', displayName: 'Private' });
    const appB = makeApp(ownerB, store);
    const response = await request(appB).get(`/api/v1/mesh/tenants/tenant-b/mesh-groups/${created.body.data.meshGroupId}`);
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('MESH_RESOURCE_NOT_FOUND');
  });

  test('makes repeated idempotent group creation return the original result', async () => {
    const app = makeApp(ownerA, store);
    const payload = { meshKey: 'repeatable', displayName: 'Repeatable' };
    const first = await request(app).post('/api/v1/mesh/tenants/tenant-a/mesh-groups').set('Idempotency-Key', 'same').send(payload);
    const second = await request(app).post('/api/v1/mesh/tenants/tenant-a/mesh-groups').set('Idempotency-Key', 'same').send(payload);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.meshGroupId).toBe(first.body.data.meshGroupId);
  });

  test('rejects a non-management role from mutations', async () => {
    const app = makeApp({ ...ownerA, role: 'viewer' }, store);
    const response = await request(app).post('/api/v1/mesh/tenants/tenant-a/mesh-groups').send({ meshKey: 'blocked', displayName: 'Blocked' });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('MESH_MANAGEMENT_ROLE_REQUIRED');
  });
});
