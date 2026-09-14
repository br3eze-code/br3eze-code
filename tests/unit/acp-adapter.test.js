import { describe, expect, test } from '@jest/globals';
import {
  ACP_VERSION,
  getAcpAlignmentInfo,
  requireIdempotencyKey,
  toCheckoutSnapshot,
  toCommerceProduct,
  toCommerceProductFeed,
} from '../../src/commerce/acp/index.js';

describe('ACP commerce alignment adapter', () => {
  test('pins the adapter to the reviewed ACP stable snapshot', () => {
    expect(ACP_VERSION).toBe('2026-04-17');
    expect(getAcpAlignmentInfo().status).toBe('adapter-boundary-only');
  });

  test('maps an internal product without leaking the raw document', () => {
    const product = toCommerceProduct({
      id: 'router-1',
      name: 'Office Router',
      description: 'Dual-band router',
      price: 75,
      currency: 'usd',
      stock: 4,
      brand: 'Example',
      category: 'Networking',
      internalOnly: 'do-not-export',
    }, { publicUrl: 'https://shop.example' });

    expect(product).toMatchObject({
      id: 'router-1',
      title: 'Office Router',
      price: 75,
      currency: 'USD',
      availability: 'in_stock',
      quantity: 4,
      url: 'https://shop.example/product/router-1',
    });
    expect(product.internalOnly).toBeUndefined();
  });

  test('builds a feed from products', () => {
    expect(toCommerceProductFeed([{ id: 'a', name: 'A', price: 1, stock: 0 }])).toEqual([
      expect.objectContaining({ id: 'a', availability: 'out_of_stock' }),
    ]);
  });

  test('creates an authoritative checkout snapshot', () => {
    const snapshot = toCheckoutSnapshot({
      id: 'order-1',
      items: [{ productId: 'a', name: 'A', qty: 2, price: 5 }],
      subtotal: 10,
      shipping: 5,
      total: 15,
      currency: 'usd',
      status: 'pending_payment',
      fulfillmentStatus: 'unfulfilled',
    });

    expect(snapshot).toMatchObject({
      id: 'order-1',
      subtotal: 10,
      shipping: 5,
      total: 15,
      currency: 'USD',
      status: 'pending_payment',
    });
    expect(snapshot.items[0]).toMatchObject({ productId: 'a', quantity: 2, unitPrice: 5 });
  });

  test('requires a bounded idempotency key for mutations', () => {
    expect(requireIdempotencyKey('checkout-123')).toBe('checkout-123');
    expect(() => requireIdempotencyKey('')).toThrow(/idempotency key/i);
    expect(() => requireIdempotencyKey('x'.repeat(256))).toThrow(/idempotency key/i);
  });
});
