import { describe, expect, jest, test } from '@jest/globals';

const shopMock = {
  listProducts: jest.fn(),
  getProduct: jest.fn(),
  productUrl: jest.fn((id) => `/product/${id}`),
  orderUrl: jest.fn((id) => `/order/${id}`),
  getCart: jest.fn(),
  addToCart: jest.fn(),
  removeFromCart: jest.fn(),
  clearCart: jest.fn(),
  checkout: jest.fn(),
  createShipment: jest.fn(async (...args) => ({ orderId: args[0], provider: args[1], trackingId: 'TRK-1' })),
  trackShipment: jest.fn(async (...args) => ({ orderId: args[0], scope: args[1], status: 'in_transit' })),
  getPaymentMethods: jest.fn(() => []),
  submitReview: jest.fn(),
  getReviews: jest.fn(),
  relatedProducts: jest.fn(),
};

jest.unstable_mockModule('../../src/core/shop.js', () => shopMock);

const { CourierGateway } = await import('../../src/core/courier-gateway.js');
const { default: ShopSkill } = await import('../../src/skills/shop/index.js');

describe('courier agent', () => {
  test('initializes ESM providers and reports configured status without network calls', () => {
    const gateway = new CourierGateway({});
    expect(gateway.getAvailableProviders()).toEqual([
      expect.objectContaining({ id: 'dhl', configured: false, supportsCreate: true }),
      expect.objectContaining({ id: 'pargo', configured: false, supportsCreate: true }),
      expect.objectContaining({ id: 'courier_guy', configured: false, supportsCreate: false }),
    ]);
  });

  test('blocks shipment creation for anonymous callers and non-logistics roles', async () => {
    const skill = new ShopSkill({}, { warn: jest.fn() });
    await expect(skill.execute('shop.create_shipment', { orderId: 'order-1', provider: 'dhl' }, {}))
      .rejects.toThrow('Link your account');
    await expect(skill.execute('shop.create_shipment', { orderId: 'order-1', provider: 'dhl' }, { userId: 'u1', role: 'customer' }))
      .rejects.toThrow('authorized logistics role');
    expect(shopMock.createShipment).not.toHaveBeenCalled();
  });

  test('passes identity-linked scope to authorized shipment operations', async () => {
    const skill = new ShopSkill({}, { warn: jest.fn() });
    const ctx = { userId: 'u1', role: 'logistics', tenantId: 't1', domain: 'shopping', siteId: 's1' };
    await skill.execute('shop.create_shipment', { orderId: 'order-1', provider: 'dhl' }, ctx);
    await skill.execute('shop.track_shipment', { orderId: 'order-1' }, ctx);
    expect(shopMock.createShipment).toHaveBeenCalledWith('order-1', 'dhl', { tenantId: 't1', domain: 'shopping', siteId: 's1' });
    expect(shopMock.trackShipment).toHaveBeenCalledWith('order-1', { tenantId: 't1', domain: 'shopping', siteId: 's1' });
  });
});
