import { describe, expect, test } from '@jest/globals';
import acpAdapter, {
  toCommerceProduct,
  toCommerceProductFeed,
  toCheckoutSnapshot,
  requireIdempotencyKey,
  getAcpAlignmentInfo,
} from '../../src/commerce/acp/index.js';

const { ACP_VERSION } = acpAdapter;

describe('commerce/acp adapter boundary (frozen mapping contract)', () => {
  describe('toCommerceProduct', () => {
    test('maps a fully populated internal product to the commerce shape', () => {
      const record = toCommerceProduct(
        {
          id: 'sku-1',
          name: 'Router',
          description: 'A router',
          brand: 'MikroTik',
          category: 'Networking',
          sku: 'RB-001',
          price: 49.99,
          currency: 'usd',
          stock: 5,
          image: 'https://example.com/router.png',
          images: ['https://example.com/router.png'],
          variants: ['black'],
          sizes: ['standard'],
          rating: 4.5,
          reviewCount: 12,
        },
        { publicUrl: 'https://br3eze.africa/' },
      );

      expect(record).toEqual({
        id: 'sku-1',
        title: 'Router',
        description: 'A router',
        brand: 'MikroTik',
        category: 'Networking',
        sku: 'RB-001',
        price: 49.99,
        currency: 'USD',
        availability: 'in_stock',
        quantity: 5,
        url: 'https://br3eze.africa/product/sku-1',
        image: 'https://example.com/router.png',
        images: ['https://example.com/router.png'],
        variants: ['black'],
        sizes: ['standard'],
        rating: 4.5,
        reviewCount: 12,
      });
    });

    test('requires a product id', () => {
      expect(() => toCommerceProduct({})).toThrow('Product id is required');
    });

    test('falls back to title/id and derives availability from stock when absent', () => {
      const record = toCommerceProduct({ id: 'sku-2', title: 'Cable', stock: 0 });
      expect(record.title).toBe('Cable');
      expect(record.availability).toBe('out_of_stock');
      expect(record.quantity).toBe(0);
      expect(record.currency).toBe('USD');
    });

    test('prefers an explicit availability field over derived stock state', () => {
      const record = toCommerceProduct({ id: 'sku-3', name: 'Preorder item', stock: 0, availability: 'preorder' });
      expect(record.availability).toBe('preorder');
    });

    test('never exposes fields outside the documented commerce shape', () => {
      const record = toCommerceProduct({
        id: 'sku-4',
        name: 'Widget',
        stock: 1,
        internalFirestorePath: 'tenants/x/products/sku-4',
        ownerUid: 'uid-secret',
      });
      expect(record).not.toHaveProperty('internalFirestorePath');
      expect(record).not.toHaveProperty('ownerUid');
    });

    test('defaults to the configured public URL from the environment', () => {
      const previous = process.env.PUBLIC_URL;
      process.env.PUBLIC_URL = 'https://shop.example/';
      try {
        const record = toCommerceProduct({ id: 'sku-5', name: 'Env product' });
        expect(record.url).toBe('https://shop.example/product/sku-5');
      } finally {
        if (previous === undefined) delete process.env.PUBLIC_URL;
        else process.env.PUBLIC_URL = previous;
      }
    });
  });

  describe('toCommerceProductFeed', () => {
    test('maps a list of products in order', () => {
      const feed = toCommerceProductFeed([
        { id: 'a', name: 'A', stock: 1 },
        { id: 'b', name: 'B', stock: 0 },
      ]);
      expect(feed.map((p) => p.id)).toEqual(['a', 'b']);
      expect(feed[0].availability).toBe('in_stock');
      expect(feed[1].availability).toBe('out_of_stock');
    });

    test('returns an empty array for no input', () => {
      expect(toCommerceProductFeed()).toEqual([]);
    });
  });

  describe('toCheckoutSnapshot', () => {
    test('maps cart items and totals into the neutral checkout shape', () => {
      const snapshot = toCheckoutSnapshot({
        id: 'order-1',
        items: [{ productId: 'sku-1', name: 'Router', qty: 2, price: 49.99, size: 'black' }],
        subtotal: 99.98,
        shipping: 5,
        total: 104.98,
        currency: 'usd',
        status: 'pending_payment',
        fulfillmentStatus: 'unfulfilled',
        shippingAddress: { line1: '1 Main St' },
      });

      expect(snapshot).toEqual({
        id: 'order-1',
        items: [
          {
            productId: 'sku-1',
            title: 'Router',
            quantity: 2,
            unitPrice: 49.99,
            currency: 'USD',
            variant: 'black',
          },
        ],
        subtotal: 99.98,
        shipping: 5,
        total: 104.98,
        currency: 'USD',
        status: 'pending_payment',
        fulfillmentStatus: 'unfulfilled',
        shippingAddress: { line1: '1 Main St' },
      });
    });

    test('never accepts or echoes a payment token', () => {
      const snapshot = toCheckoutSnapshot({
        id: 'order-2',
        items: [],
        paymentToken: 'tok_should_not_appear',
      });
      expect(snapshot).not.toHaveProperty('paymentToken');
    });

    test('produces safe defaults for an empty cart', () => {
      const snapshot = toCheckoutSnapshot();
      expect(snapshot.items).toEqual([]);
      expect(snapshot.subtotal).toBe(0);
      expect(snapshot.total).toBe(0);
      expect(snapshot.status).toBe('pending_payment');
    });
  });

  describe('requireIdempotencyKey', () => {
    test('accepts a reasonable key', () => {
      expect(requireIdempotencyKey('req-123')).toBe('req-123');
    });

    test('rejects a missing key', () => {
      expect(() => requireIdempotencyKey(undefined)).toThrow(
        'A valid idempotency key is required for agentic commerce mutations.',
      );
    });

    test('rejects a blank key', () => {
      expect(() => requireIdempotencyKey('   ')).toThrow();
    });

    test('rejects an oversized key', () => {
      expect(() => requireIdempotencyKey('x'.repeat(256))).toThrow();
    });

    test('attaches a 400 status to the rejection', () => {
      try {
        requireIdempotencyKey('');
        throw new Error('expected requireIdempotencyKey to throw');
      } catch (err) {
        expect(err.status).toBe(400);
      }
    });
  });

  describe('getAcpAlignmentInfo', () => {
    test('reports the adapter-boundary-only status and does not claim ACP certification', () => {
      const info = getAcpAlignmentInfo();
      expect(info.status).toBe('adapter-boundary-only');
      expect(info.version).toBe(ACP_VERSION);
      expect(info.checkoutEngine).toBe('src/core/shop.js');
      expect(info.catalogEngine).toBe('src/core/shop.js');
      expect(info.note).toMatch(/does not by itself/i);
    });
  });
});
