import { describe, expect, test, jest } from '@jest/globals';
import { createSupplierApiAdapter, configuredEndpoint } from '../../src/domains/procurement/supplier-api-adapter.js';

const env = {
  NODE_ENV: 'test',
  BR3EZE_SUPPLIER_API_URL: 'https://api.supplier.example/v1/',
  BR3EZE_SUPPLIER_API_TOKEN: 'test-token-not-real',
};

const order = {
  supplierId: 'supplier-1',
  orderId: 'po-1',
  tenantId: 'tenant-1',
  idempotencyKey: 'request-1',
  lines: [{
    productId: 'product-1',
    quantity: 2,
    unitPrice: 7.5,
    currency: 'USD',
    supplierSku: 'SUP-123',
    supplierReferenceUrl: 'https://supplier.example/catalog/SUP-123',
  }],
};

describe('configured supplier API adapter', () => {
  test('posts to configured API endpoint and sends idempotency key plus product supplier reference', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ supplierOrderId: 'supplier-order-42', status: 'accepted' }),
    });
    const adapter = createSupplierApiAdapter({ env, fetchImpl });
    await expect(adapter.createPurchaseOrder(order)).resolves.toEqual({
      supplierOrderId: 'supplier-order-42',
      status: 'accepted',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://api.supplier.example/v1/purchase-orders');
    expect(options.headers.authorization).toBe('Bearer test-token-not-real');
    expect(options.headers['idempotency-key']).toBe('request-1');
    const payload = JSON.parse(options.body);
    expect(payload.items[0]).toMatchObject({
      productId: 'product-1',
      supplierSku: 'SUP-123',
      supplierReferenceUrl: 'https://supplier.example/catalog/SUP-123',
      quantity: 2,
    });
  });

  test('never uses a product supplier reference URL as the API destination', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ supplierOrderId: 'external-1' }) });
    const adapter = createSupplierApiAdapter({ env, fetchImpl });
    await adapter.createPurchaseOrder({ ...order, lines: [{ ...order.lines[0], supplierReferenceUrl: 'https://attacker.example/collect' }] });
    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://api.supplier.example/v1/purchase-orders');
  });

  test('fails closed when API URL or credentials are missing', async () => {
    const fetchImpl = jest.fn();
    await expect(createSupplierApiAdapter({ env: { NODE_ENV: 'test' }, fetchImpl }).createPurchaseOrder(order))
      .rejects.toMatchObject({ code: 'SUPPLIER_API_NOT_CONFIGURED' });
    await expect(createSupplierApiAdapter({ env: { ...env, BR3EZE_SUPPLIER_API_TOKEN: '' }, fetchImpl }).createPurchaseOrder(order))
      .rejects.toMatchObject({ code: 'SUPPLIER_API_NOT_CONFIGURED', status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('rejects non-HTTPS API destinations outside local test endpoints', () => {
    expect(() => configuredEndpoint({ BR3EZE_SUPPLIER_API_URL: 'http://supplier.example/api' }))
      .toThrow(/HTTPS/);
    expect(() => configuredEndpoint({ BR3EZE_SUPPLIER_API_URL: 'https://user:secret@supplier.example/api' }))
      .toThrow(/credentials/);
  });

  test('does not leak supplier response bodies when API rejects a request', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'private provider payload' });
    const adapter = createSupplierApiAdapter({ env, fetchImpl });
    await expect(adapter.createPurchaseOrder(order)).rejects.toMatchObject({
      code: 'SUPPLIER_API_REJECTED',
      message: 'Supplier API rejected purchase order (HTTP 500)',
    });
  });

  test('rejects a successful but malformed supplier response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 'accepted' }) });
    await expect(createSupplierApiAdapter({ env, fetchImpl }).createPurchaseOrder(order))
      .rejects.toMatchObject({ code: 'SUPPLIER_API_ERROR' });
  });
});
