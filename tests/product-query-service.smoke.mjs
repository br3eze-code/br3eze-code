import assert from 'node:assert/strict';
import { ProductQueryService } from '../dist/core/product-query-service.js';

const records = [
  { id: 'a-1', tenant_id: 'tenant-a', site_id: 'site-a', name: 'Router', brand: 'Acme', tier: 'pro', price_cents: 10000, currency: 'USD', stock: 5, active: 1 },
  { id: 'b-1', tenant_id: 'tenant-b', site_id: 'site-b', name: 'Router', brand: 'Acme', tier: 'pro', price_cents: 9000, currency: 'USD', stock: 9, active: 1 },
];
const sql = {
  async queryProducts({ scope }) {
    return records.filter((item) => item.tenant_id === scope.tenantId && (!scope.siteId || item.site_id === scope.siteId));
  }
};
const firebase = {
  async queryProducts({ scope }) {
    return records.filter((item) => item.tenant_id === scope.tenantId && (!scope.siteId || item.site_id === scope.siteId));
  }
};

const service = new ProductQueryService({ sql, firebase });
const scoped = await service.search({
  scope: { tenantId: 'tenant-a', userId: 'user-a', siteId: 'site-a' },
  filters: { brand: 'Acme' },
  include: ['price', 'availability'],
  viewerRole: 'cashier',
  viewerTier: 'standard'
});
assert.equal(scoped.items.length, 1);
assert.equal(scoped.items[0].tenantId, 'tenant-a');
assert.equal(scoped.items[0].price, 100);
assert.equal(scoped.items[0].availability, 'in_stock');
assert.equal(scoped.items[0].description, undefined);

const fallback = new ProductQueryService({
  sql: { async queryProducts() { throw new Error('sql unavailable'); } },
  firebase
});
const degraded = await fallback.search({ scope: { tenantId: 'tenant-a', userId: 'user-a', siteId: 'site-a' }, source: 'auto' });
assert.equal(degraded.source, 'firebase');
assert.equal(degraded.freshness, 'projection');
assert.match(degraded.warnings.join(' '), /sql query failed/);

const requests = Array.from({ length: 500 }, (_, index) => {
  const tenantId = index % 2 === 0 ? 'tenant-a' : 'tenant-b';
  const siteId = index % 2 === 0 ? 'site-a' : 'site-b';
  return service.search({ scope: { tenantId, userId: `user-${index}`, siteId }, include: ['name'] });
});
const results = await Promise.all(requests);
results.forEach((result, index) => {
  const expectedTenant = index % 2 === 0 ? 'tenant-a' : 'tenant-b';
  assert.ok(result.items.every((item) => item.tenantId === expectedTenant));
});

const hidden = await service.search({ scope: { tenantId: 'tenant-c', userId: 'user-c', siteId: 'site-c' } });
assert.equal(hidden.items.length, 0);
console.log('PRODUCT_QUERY_SERVICE_OK concurrent=500 isolation=pass');
