import { defineSkill, defineTool } from '../skill.js';
import { scopeFrom, providerFrom, assertTenant, approvalOrProposal, providerCall } from './commerce-helpers.js';

const ordersSkill = defineSkill({
  name: 'orders',
  description: 'Tenant-scoped carts, checkout, order state, amendments, and cancellations.',
  specialist: 'orders',
  permissions: ['orders:read'],
  ticketTypes: ['order-create', 'order-amend', 'order-cancel', 'checkout-validation'],
  persona: 'Orders Specialist: recheck price and availability, preserve idempotency, and transition orders only through valid states.',
  tools: [
    defineTool({ name: 'orders.create', description: 'Validate and propose or create an idempotent order.', specialist: 'orders', permissions: ['orders:write'], ticketTypes: ['order-create'], risk: 'high', parameters: { type: 'object', required: ['items', 'idempotencyKey'], properties: { items: { type: 'array' }, idempotencyKey: { type: 'string' }, customerId: { type: 'string' }, currency: { type: 'string' } } }, outputSchema: {}, handler: async (args, context) => { const proposal = approvalOrProposal('orders.create', args, context, { risk: 'high' }); if (proposal) return proposal; return assertTenant(await providerCall(providerFrom(context, 'orders'), 'create', { ...args, scope: scopeFrom(context) }), context.tenantId); } }),
    defineTool({ name: 'orders.get', description: 'Read one tenant-scoped order and immutable state history.', specialist: 'orders', permissions: ['orders:read'], ticketTypes: ['order-create', 'order-amend', 'order-cancel'], parameters: { type: 'object', required: ['orderId'], properties: { orderId: { type: 'string' } } }, outputSchema: {}, handler: async ({ orderId }, context) => assertTenant(await providerCall(providerFrom(context, 'orders'), 'get', { orderId, scope: scopeFrom(context) }), context.tenantId) }),
    defineTool({ name: 'orders.amend', description: 'Propose or apply a material order amendment after rechecking price and availability.', specialist: 'orders', permissions: ['orders:write'], ticketTypes: ['order-amend'], risk: 'high', parameters: { type: 'object', required: ['orderId', 'changes', 'idempotencyKey'], properties: { orderId: { type: 'string' }, changes: { type: 'object' }, idempotencyKey: { type: 'string' } } }, outputSchema: {}, handler: async (args, context) => { const proposal = approvalOrProposal('orders.amend', args, context, { risk: 'high' }); if (proposal) return proposal; return assertTenant(await providerCall(providerFrom(context, 'orders'), 'amend', { ...args, scope: scopeFrom(context) }), context.tenantId); } }),
    defineTool({ name: 'orders.cancel', description: 'Propose or execute a valid, auditable order cancellation.', specialist: 'orders', permissions: ['orders:write'], ticketTypes: ['order-cancel'], risk: 'high', parameters: { type: 'object', required: ['orderId', 'idempotencyKey', 'reason'], properties: { orderId: { type: 'string' }, idempotencyKey: { type: 'string' }, reason: { type: 'string' } } }, outputSchema: {}, handler: async (args, context) => { const proposal = approvalOrProposal('orders.cancel', args, context, { risk: 'high' }); if (proposal) return proposal; return assertTenant(await providerCall(providerFrom(context, 'orders'), 'cancel', { ...args, scope: scopeFrom(context) }), context.tenantId); } }),
  ],
});

export { ordersSkill };
export default ordersSkill;
