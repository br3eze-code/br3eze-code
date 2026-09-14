import { describe, expect, jest, test } from '@jest/globals';
import { executeCheckout, namespaceKey } from '../../src/commerce/acp/checkout-orchestrator.js';

class MemoryIdempotencyStore {
  constructor() {
    this.records = new Map();
  }

  get(key) {
    const record = this.records.get(key);
    if (!record) return undefined;
    if (record.state === 'completed') return record.result;
    return { pending: true, state: record.state, metadata: record.metadata || {} };
  }

  reserve(key, metadata) {
    if (this.records.has(key)) return false;
    this.records.set(key, { state: 'pending', metadata });
    return true;
  }

  set(key, value) {
    this.records.set(key, { state: 'completed', result: value });
    return value;
  }

  release(key) {
    return this.records.delete(key);
  }
}

const input = (overrides = {}) => ({
  idempotencyKey: 'checkout-123',
  merchantId: 'merchant-1',
  buyerId: 'user-1',
  platform: 'web',
  channelId: 'user-1',
  address: { city: 'Harare', country: 'ZW' },
  payMethod: 'cod',
  scope: { tenantId: 'merchant-1' },
  ...overrides,
});

describe('ACP checkout orchestrator', () => {
  test('namespaces idempotency by merchant and buyer', () => {
    expect(namespaceKey({ idempotencyKey: 'x', merchantId: 'm1', buyerId: 'u1' }))
      .not.toBe(namespaceKey({ idempotencyKey: 'x', merchantId: 'm1', buyerId: 'u2' }));
    expect(namespaceKey({ idempotencyKey: 'x', merchantId: 'm1', buyerId: 'u1' }))
      .not.toBe(namespaceKey({ idempotencyKey: 'x', merchantId: 'm2', buyerId: 'u1' }));
  });

  test('executes checkout once and replays the completed result', async () => {
    const store = new MemoryIdempotencyStore();
    const checkoutFn = jest.fn().mockResolvedValue({ orderId: 'order-1', total: 15 });

    const first = await executeCheckout({ ...input(), idempotencyStore: store, checkoutFn });
    const second = await executeCheckout({ ...input(), idempotencyStore: store, checkoutFn });

    expect(checkoutFn).toHaveBeenCalledTimes(1);
    expect(first.orderId).toBe('order-1');
    expect(first.replayed).toBeUndefined();
    expect(second).toMatchObject({ orderId: 'order-1', replayed: true });
  });

  test('rejects the same idempotency key for a different request', async () => {
    const store = new MemoryIdempotencyStore();
    const checkoutFn = jest.fn().mockResolvedValue({ orderId: 'order-2' });

    await executeCheckout({ ...input(), idempotencyStore: store, checkoutFn });
    await expect(executeCheckout({
      ...input(),
      address: { city: 'Bulawayo', country: 'ZW' },
      idempotencyStore: store,
      checkoutFn,
    })).rejects.toMatchObject({ status: 409 });

    expect(checkoutFn).toHaveBeenCalledTimes(1);
  });

  test('rejects a second request while the first request is pending', async () => {
    const store = new MemoryIdempotencyStore();
    let resolveCheckout;
    const checkoutFn = jest.fn(() => new Promise((resolve) => { resolveCheckout = resolve; }));

    const first = executeCheckout({ ...input(), idempotencyStore: store, checkoutFn });
    await expect(executeCheckout({ ...input(), idempotencyStore: store, checkoutFn }))
      .rejects.toMatchObject({ status: 409 });

    resolveCheckout({ orderId: 'order-3' });
    await expect(first).resolves.toMatchObject({ orderId: 'order-3' });
    expect(checkoutFn).toHaveBeenCalledTimes(1);
  });

  test('releases a reservation when checkout fails so a retry can proceed', async () => {
    const store = new MemoryIdempotencyStore();
    const checkoutFn = jest.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ orderId: 'order-4' });

    await expect(executeCheckout({ ...input(), idempotencyStore: store, checkoutFn }))
      .rejects.toThrow('temporary failure');
    await expect(executeCheckout({ ...input(), idempotencyStore: store, checkoutFn }))
      .resolves.toMatchObject({ orderId: 'order-4' });

    expect(checkoutFn).toHaveBeenCalledTimes(2);
  });

  test('passes the authenticated buyer identity and commerce scope to the checkout engine', async () => {
    const store = new MemoryIdempotencyStore();
    const checkoutFn = jest.fn().mockResolvedValue({ orderId: 'order-5' });

    await executeCheckout({ ...input(), idempotencyStore: store, checkoutFn });

    expect(checkoutFn).toHaveBeenCalledWith(
      'web',
      'user-1',
      expect.objectContaining({
        uid: 'user-1',
        scope: { tenantId: 'merchant-1' },
        payMethod: 'cod',
      }),
    );
  });

  test('validates required mutation inputs before touching the store', async () => {
    const store = new MemoryIdempotencyStore();
    const checkoutFn = jest.fn();

    await expect(executeCheckout({ ...input(), idempotencyKey: '', idempotencyStore: store, checkoutFn }))
      .rejects.toThrow(/idempotency key/i);
    await expect(executeCheckout({ ...input(), merchantId: '', idempotencyStore: store, checkoutFn }))
      .rejects.toThrow('merchantId is required.');
    await expect(executeCheckout({ ...input(), platform: '', idempotencyStore: store, checkoutFn }))
      .rejects.toThrow('platform and channelId are required.');
    expect(checkoutFn).not.toHaveBeenCalled();
  });
});
