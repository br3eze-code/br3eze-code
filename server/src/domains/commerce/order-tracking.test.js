import { jest } from '@jest/globals';
import { registerOrderTrackingRoutes } from './order-tracking.js';

function harness({ order, role = 'customer', uid = 'buyer-1', tenantId = 'tenant-1', courierResult = {} } = {}) {
  const routes = new Map();
  const app = {
    get: (path, ...handlers) => routes.set(`GET ${path}`, handlers),
    post: (path, ...handlers) => routes.set(`POST ${path}`, handlers)
  };
  const ref = {
    get: jest.fn(async () => ({ exists: Boolean(order), id: 'order-1', data: () => order })),
    update: jest.fn(async () => {})
  };
  const db = { collection: jest.fn(() => ({ doc: jest.fn(() => ref) })) };
  const courierGateway = { trackShipment: jest.fn(async () => courierResult) };
  const logger = { error: jest.fn(), warn: jest.fn() };
  registerOrderTrackingRoutes({ app, db, authMiddleware: (_req, _res, next) => next(), logger, courierGateway });
  const invoke = async (key, req = {}) => {
    const handlers = routes.get(key);
    const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handlers[handlers.length - 1]({ params: { orderId: 'order-1' }, user: { uid, role, tenantId }, ...req }, response);
    return response;
  };
  return { routes, ref, courierGateway, invoke };
}

describe('order tracking routes', () => {
  test('returns scoped tracking to the order owner', async () => {
    const h = harness({ order: { userId: 'buyer-1', tenantId: 'tenant-1', fulfillmentStatus: 'in_transit', courier: { provider: 'dhl', trackingId: 'track-1' } } });
    const res = await h.invoke('GET /api/v1/orders/:orderId/tracking');
    expect(res.statusCode).toBe(200);
    expect(res.body.tracking.shipment.trackingId).toBe('track-1');
  });

  test('does not disclose orders belonging to another user', async () => {
    const h = harness({ order: { userId: 'someone-else', tenantId: 'tenant-1' } });
    const res = await h.invoke('GET /api/v1/orders/:orderId/tracking');
    expect(res.statusCode).toBe(404);
  });

  test('requires logistics role to refresh courier tracking', async () => {
    const h = harness({ order: { userId: 'buyer-1', tenantId: 'tenant-1', courier: { provider: 'dhl', trackingId: 'track-1' } } });
    const res = await h.invoke('POST /api/v1/orders/:orderId/tracking/refresh');
    expect(res.statusCode).toBe(403);
    expect(h.courierGateway.trackShipment).not.toHaveBeenCalled();
  });

  test('refreshes status and persists changed shipment state', async () => {
    const h = harness({ role: 'logistics', order: { userId: 'buyer-1', tenantId: 'tenant-1', fulfillmentStatus: 'in_transit', courier: { provider: 'dhl', trackingId: 'track-1', status: 'in_transit' } }, courierResult: { status: 'delivered', events: [{ status: 'delivered' }] } });
    const res = await h.invoke('POST /api/v1/orders/:orderId/tracking/refresh');
    expect(res.statusCode).toBe(200);
    expect(res.body.tracking.fulfillmentStatus).toBe('delivered');
    expect(h.ref.update).toHaveBeenCalledWith(expect.objectContaining({ fulfillmentStatus: 'delivered' }));
  });
});
