import { CourierGateway } from '../src/core/courier-gateway.js';

const total = Number(process.env.COURIER_LOAD_REQUESTS || 1000);
const concurrency = Number(process.env.COURIER_LOAD_CONCURRENCY || 100);
if (!Number.isInteger(total) || total < 1 || !Number.isInteger(concurrency) || concurrency < 1) {
  throw new Error('COURIER_LOAD_REQUESTS and COURIER_LOAD_CONCURRENCY must be positive integers');
}

let completed = 0;
const gateway = new CourierGateway({ auditSink: () => {} });
gateway.providers.set('load-test', {
  name: 'Load Test Courier',
  configHint: 'none',
  verified: { trackShipment: true, createShipment: true },
  supportsCreate: true,
  isConfigured: () => true,
  async createShipment(order) {
    completed += 1;
    return { trackingId: `LOAD-${order.orderId}`, raw: null };
  },
  async trackShipment() { return { status: 'in_transit' }; },
});

const context = {
  userId: 'load-test-user', role: 'logistics', tenantId: 'load-test-tenant',
  domain: 'shopping', siteId: 'load-test-site', locationPermission: false,
};
const started = performance.now();
let next = 0;
async function worker() {
  while (true) {
    const index = next;
    next += 1;
    if (index >= total) return;
    await gateway.createShipment('load-test', { orderId: `order-${index}`, items: [] }, context);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
const elapsedMs = performance.now() - started;
const rate = completed / (elapsedMs / 1000);
console.log(JSON.stringify({ total, concurrency, completed, elapsedMs: Math.round(elapsedMs * 100) / 100, requestsPerSecond: Math.round(rate * 100) / 100 }));
