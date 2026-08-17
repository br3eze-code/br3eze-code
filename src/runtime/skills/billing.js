import { defineSkill, defineTool } from '../skill.js';
import { scopeFrom, providerFrom, assertTenant, approvalOrProposal, providerCall } from './commerce-helpers.js';

const billingSkill = defineSkill({
  name: 'billing',
  description: 'Tenant-scoped payment authorization, capture, refunds, credits, ledger reconciliation, and billing controls.',
  specialist: 'billing',
  permissions: ['billing:read'],
  ticketTypes: ['payment-authorization', 'payment-capture', 'refund-request', 'billing-reconciliation'],
  persona: 'Billing Specialist: separate calculation, authorization, settlement, refund, and reconciliation with redacted evidence.',
  tools: [
    defineTool({ name: 'billing.authorize', description: 'Authorize a verified amount without treating authorization as settlement.', specialist: 'billing', permissions: ['billing:write'], ticketTypes: ['payment-authorization'], risk: 'high', parameters: { type: 'object', required: ['orderId', 'amountMinor', 'currency', 'idempotencyKey'], properties: { orderId: { type: 'string' }, amountMinor: { type: 'integer', minimum: 0 }, currency: { type: 'string' }, idempotencyKey: { type: 'string' }, paymentMethodRef: { type: 'string' } } }, outputSchema: {}, handler: async (args, context) => assertTenant(await providerCall(providerFrom(context, 'billing'), 'authorize', { ...args, scope: scopeFrom(context) }), context.tenantId) }),
    defineTool({ name: 'billing.capture', description: 'Capture an authorized payment through an idempotent provider operation.', specialist: 'billing', permissions: ['billing:write'], ticketTypes: ['payment-capture'], risk: 'high', parameters: { type: 'object', required: ['authorizationId', 'amountMinor', 'currency', 'idempotencyKey'], properties: { authorizationId: { type: 'string' }, amountMinor: { type: 'integer', minimum: 0 }, currency: { type: 'string' }, idempotencyKey: { type: 'string' } } }, outputSchema: {}, handler: async (args, context) => { const proposal = approvalOrProposal('billing.capture', args, context, { risk: 'high' }); if (proposal) return proposal; return assertTenant(await providerCall(providerFrom(context, 'billing'), 'capture', { ...args, scope: scopeFrom(context) }), context.tenantId); } }),
    defineTool({ name: 'billing.refund', description: 'Propose or execute a policy-approved refund without exposing payment secrets.', specialist: 'billing', permissions: ['billing:write'], ticketTypes: ['refund-request'], risk: 'critical', parameters: { type: 'object', required: ['transactionId', 'amountMinor', 'currency', 'reason', 'idempotencyKey'], properties: { transactionId: { type: 'string' }, amountMinor: { type: 'integer', minimum: 0 }, currency: { type: 'string' }, reason: { type: 'string' }, idempotencyKey: { type: 'string' } } }, outputSchema: {}, handler: async (args, context) => { const proposal = approvalOrProposal('billing.refund', args, context, { risk: 'critical' }); if (proposal) return proposal; return assertTenant(await providerCall(providerFrom(context, 'billing'), 'refund', { ...args, scope: scopeFrom(context) }), context.tenantId); } }),
    defineTool({ name: 'billing.reconcile', description: 'Reconcile authenticated provider transactions with the tenant ledger.', specialist: 'billing', permissions: ['billing:reconcile'], ticketTypes: ['billing-reconciliation'], parameters: { type: 'object', required: ['transactionRefs'], properties: { transactionRefs: { type: 'array', items: { type: 'string' } }, evidenceRefs: { type: 'array', items: { type: 'string' } } } }, outputSchema: {}, handler: async (args, context) => assertTenant(await providerCall(providerFrom(context, 'billing'), 'reconcile', { ...args, scope: scopeFrom(context) }), context.tenantId) }),
  ],
});

export { billingSkill };
export default billingSkill;
