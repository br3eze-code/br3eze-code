import { describe, expect, test, jest } from '@jest/globals';
import { registerSupplierProvisioningRoutes, safeReferenceUrl } from '../../server/src/domains/procurement/registerRoutes.js';

function makeDb(records) {
  return {
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              const value = records[name]?.[id];
              return { exists: value != null, id, data: () => value };
            },
          };
        },
      };
    },
  };
}

function makeApp() {
  const routes = { get: new Map(), post: new Map() };
  return {
    routes,
    get(path, ...handlers) { routes.get.set(path, handlers.at(-1)); },
    post(path, ...handlers) { routes.post.set(path, handlers.at(-1)); },
  };
}

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const user = { id: 'user-a', roles: ['ADMIN'], permissions: ['*'] };
const records = {
  users: { 'user-a': { tenantId: 'tenant-a', projectId: 'project-a' } },
  products: {
    'product-a': {
      tenantId: 'tenant-a', supplierId: 'supplier-a', supplierSku: 'SKU-A',
      supplierReferenceUrl: 'https://supplier.example/catalog/SKU-A',
      supplierUnitCost: 8.5, supplierCurrency: 'USD', price: 12, stock: 0,
    },
    'unsafe-product': {
      tenantId: 'tenant-a', supplierId: 'supplier-a',
      supplierReferenceUrl: 'http://127.0.0.1/admin', supplierUnitCost: 8.5,
    },
  },
};

describe('supplier provisioning HTTP boundary', () => {
  test('returns product supplier reference metadata without exposing API credentials', async () => {
    const app = makeApp();
    registerSupplierProvisioningRoutes({ app, authMiddleware: (_req, _res, next) => next(), db: makeDb(records), env: { NODE_ENV: 'test' } });
    const res = makeResponse();
    await app.routes.get.get('/api/v1/shop/products/:productId/supplier-reference')({
      user, params: { productId: 'product-a' },
    }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      productId: 'product-a',
      supplierId: 'supplier-a',
      supplierSku: 'SKU-A',
      supplierReferenceUrl: 'https://supplier.example/catalog/SKU-A',
      supplierUnitCost: 8.5,
      salePrice: 12,
    });
    expect(res.body).not.toHaveProperty('apiToken');
    expect(res.body).not.toHaveProperty('authorization');
  });


  test('allows a scoped shopper to read the supplier link but never the supplier cost', async () => {
    const app = makeApp();
    registerSupplierProvisioningRoutes({ app, authMiddleware: (_req, _res, next) => next(), db: makeDb(records), env: { NODE_ENV: 'test' } });
    const res = makeResponse();
    await app.routes.get.get('/api/v1/shop/products/:productId/supplier-reference')({
      user: { id: 'user-a', roles: ['USER'], permissions: ['profile.read'] },
      params: { productId: 'product-a' },
    }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.supplierReferenceUrl).toBe('https://supplier.example/catalog/SKU-A');
    expect(res.body).not.toHaveProperty('supplierUnitCost');
    expect(res.body).not.toHaveProperty('supplierCurrency');
  });

  test('does not return unsafe supplier links', async () => {
    const app = makeApp();
    registerSupplierProvisioningRoutes({ app, authMiddleware: (_req, _res, next) => next(), db: makeDb(records), env: { NODE_ENV: 'test' } });
    const res = makeResponse();
    await app.routes.get.get('/api/v1/shop/products/:productId/supplier-reference')({
      user, params: { productId: 'unsafe-product' },
    }, res);
    expect(res.statusCode).toBe(404);
  });

  test('returns an approval proposal and never initializes the supplier API without approval', async () => {
    const app = makeApp();
    const fetchImpl = jest.fn();
    registerSupplierProvisioningRoutes({
      app, authMiddleware: (_req, _res, next) => next(), db: makeDb(records),
      fetchImpl, env: { NODE_ENV: 'test' },
    });
    const res = makeResponse();
    await app.routes.post.get('/api/v1/shop/supplier-orders')({
      user,
      body: { productId: 'product-a', quantity: 4, idempotencyKey: 'shopping-cart-1' },
      get: (name) => name.toLowerCase() === 'idempotency-key' ? undefined : undefined,
    }, res);
    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({
      status: 'approval_required',
      action: 'purchase.order',
      externalSupplierCalled: false,
      proposal: { supplierId: 'supplier-a', lines: [{ productId: 'product-a', quantity: 4, supplierSku: 'SKU-A' }] },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('accepts only HTTPS supplier reference links without embedded credentials', () => {
    expect(safeReferenceUrl('https://supplier.example/product')).toBe('https://supplier.example/product');
    expect(safeReferenceUrl('http://supplier.example/product')).toBeNull();
    expect(safeReferenceUrl('https://user:pass@supplier.example/product')).toBeNull();
    expect(safeReferenceUrl('javascript:alert(1)')).toBeNull();
  });
});
