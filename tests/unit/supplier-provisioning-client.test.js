import { describe, expect, test, jest } from '@jest/globals';
import { createSupplierProvisioningClient, resolveApiBase } from '../../src/adapters/commerce/supplier-provisioning-client.js';

const env = { NODE_ENV: 'test', AGENTOS_API_BASE_URL: 'https://api.br3eze.example/' };

describe('supplier provisioning API client', () => {
  test('retrieves supplier reference using request-scoped authentication', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ productId: 'p-1', supplierReferenceUrl: 'https://supplier.example/p-1' }),
    });
    const client = createSupplierProvisioningClient({ env, fetchImpl, getAccessToken: async () => 'user-token' });
    const result = await client.getSupplierReference({ productId: 'p-1', scope: { tenantId: 'tenant-a' } });
    expect(result.supplierReferenceUrl).toBe('https://supplier.example/p-1');
    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://api.br3eze.example/api/v1/shop/products/p-1/supplier-reference');
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('Bearer user-token');
  });

  test('sends approved provisioning request with stable idempotency key', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true, status: 201,
      json: async () => ({ orderId: 'po-1', status: 'ordered' }),
    });
    const client = createSupplierProvisioningClient({ env, fetchImpl, getAccessToken: async () => 'user-token' });
    await client.provisionProduct({
      productId: 'p-1', quantity: 5, idempotencyKey: 'idem-1',
      approval: { approvalId: 'approval-1' },
    });
    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://api.br3eze.example/api/v1/shop/supplier-orders');
    expect(options.headers['idempotency-key']).toBe('idem-1');
    expect(JSON.parse(options.body)).toMatchObject({ productId: 'p-1', quantity: 5, approvalId: 'approval-1' });
  });

  test('requires a token and rejects insecure API origins', async () => {
    const fetchImpl = jest.fn();
    const client = createSupplierProvisioningClient({ env, fetchImpl, getAccessToken: async () => '' });
    await expect(client.getSupplierReference({ productId: 'p-1' })).rejects.toThrow(/access token/);
    expect(() => resolveApiBase({ AGENTOS_API_BASE_URL: 'http://api.br3eze.example' })).toThrow(/HTTPS/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('surfaces API errors without reading or exposing raw response text', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false, status: 403,
      json: async () => ({ error: 'Procurement write permission is required', code: 'PROCUREMENT_PERMISSION_REQUIRED' }),
      text: async () => 'sensitive backend response',
    });
    const client = createSupplierProvisioningClient({ env, fetchImpl, getAccessToken: async () => 'user-token' });
    await expect(client.provisionProduct({ productId: 'p-1', quantity: 1, idempotencyKey: 'idem-1' }))
      .rejects.toMatchObject({ status: 403, code: 'PROCUREMENT_PERMISSION_REQUIRED' });
  });
});
