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

  test('records tenant-scoped audit events and strips raw coordinates from provider context', async () => {
    const events = [];
    const gateway = new CourierGateway({ auditSink: (event) => events.push(event) });
    gateway.providers.set('stub', {
      name: 'Stub Courier',
      verified: { trackShipment: true, createShipment: true },
      supportsCreate: true,
      isConfigured: () => true,
      createShipment: async (order) => ({ trackingId: 'STUB-1', raw: order.agentContext }),
      trackShipment: async () => ({ status: 'in_transit' }),
    });
    const context = {
      userId: 'u1', role: 'logistics', tenantId: 't1', domain: 'shopping', siteId: 's1',
      locationPermission: 'granted',
      location: { latitude: -17.8, longitude: 31.0, country: 'ZW', region: 'Harare' },
    };
    const result = await gateway.createShipment('stub', { orderId: 'order-1', items: [] }, context);
    expect(result.raw.location).toEqual({ permissionGranted: true, countryCode: 'ZW', region: 'Harare', siteId: 's1' });
    expect(result.raw.location.latitude).toBeUndefined();
    expect(events[0]).toMatchObject({ action: 'courier.shipment.create', tenantId: 't1', userId: 'u1', role: 'logistics', siteId: 's1' });
    expect(events[0].location).toEqual({ permissionGranted: true, countryCode: 'ZW', region: 'Harare', siteId: 's1' });
  });

  test('keeps audit tenant boundaries intact across logistics roles', async () => {
    const events = [];
    const gateway = new CourierGateway({ auditSink: (event) => events.push(event) });
    gateway.providers.set('audit-stub', {
      name: 'Audit Stub', verified: { trackShipment: true, createShipment: true }, supportsCreate: true,
      isConfigured: () => true,
      createShipment: async () => ({ trackingId: 'AUDIT-1' }),
      trackShipment: async () => ({ status: 'in_transit' }),
    });
    for (const role of ['admin', 'owner', 'operator', 'fulfillment', 'logistics']) {
      await gateway.createShipment('audit-stub', { orderId: `order-${role}` }, {
        userId: `${role}-user`, role, tenantId: 'tenant-a', domain: 'shopping', siteId: 'site-a',
      });
    }
    expect(events).toHaveLength(5);
    expect(events.every((event) => event.tenantId === 'tenant-a' && event.domain === 'shopping' && event.siteId === 'site-a')).toBe(true);
    expect(new Set(events.map((event) => event.role))).toEqual(new Set(['admin', 'owner', 'operator', 'fulfillment', 'logistics']));
    expect(events.some((event) => event.tenantId !== 'tenant-a' || event.siteId !== 'site-a')).toBe(false);
  });

  test('passes identity-linked scope to authorized shipment operations', async () => {
    const skill = new ShopSkill({}, { warn: jest.fn() });
    const ctx = { userId: 'u1', role: 'logistics', tenantId: 't1', domain: 'shopping', siteId: 's1' };
    await skill.execute('shop.create_shipment', { orderId: 'order-1', provider: 'dhl' }, ctx);
    await skill.execute('shop.track_shipment', { orderId: 'order-1' }, ctx);
    expect(shopMock.createShipment).toHaveBeenCalledWith('order-1', 'dhl', expect.objectContaining({ tenantId: 't1', domain: 'shopping', siteId: 's1', userId: 'u1', role: 'logistics' }));
    expect(shopMock.trackShipment).toHaveBeenCalledWith('order-1', expect.objectContaining({ tenantId: 't1', domain: 'shopping', siteId: 's1', userId: 'u1', role: 'logistics' }));
  });
});
