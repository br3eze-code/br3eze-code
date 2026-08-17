import { defineSkill, defineTool } from '../skill.js';
import { scopeFrom, providerFrom, assertTenant, approvalOrProposal, providerCall } from './commerce-helpers.js';

const voucherSkill = defineSkill({
  name: 'voucher',
  description: 'Tenant and site-scoped voucher issuance, eligibility, redemption, access plans, and revocation.',
  specialist: 'voucher',
  permissions: ['voucher:read'],
  ticketTypes: ['voucher-issue', 'voucher-validation', 'voucher-redemption', 'voucher-revocation'],
  persona: 'Voucher Specialist: protect entitlement state and keep network execution and financial effects in separate handoffs.',
  tools: [
    defineTool({ name: 'voucher.issue', description: 'Propose or issue a bounded, protected voucher entitlement.', specialist: 'voucher', permissions: ['voucher:write'], ticketTypes: ['voucher-issue'], risk: 'medium', parameters: { type: 'object', required: ['planId', 'idempotencyKey'], properties: { planId: { type: 'string' }, userId: { type: 'string' }, siteId: { type: 'string' }, idempotencyKey: { type: 'string' }, expiresAt: { type: 'string' } } }, outputSchema: {}, handler: async (args, context) => { const proposal = approvalOrProposal('voucher.issue', args, context); if (proposal) return proposal; return assertTenant(await providerCall(providerFrom(context, 'voucher'), 'issue', { ...args, scope: scopeFrom(context) }), context.tenantId); } }),
    defineTool({ name: 'voucher.validate', description: 'Validate voucher eligibility and lifecycle without exposing the raw secret.', specialist: 'voucher', permissions: ['voucher:read'], ticketTypes: ['voucher-validation', 'voucher-redemption'], parameters: { type: 'object', required: ['voucherToken'], properties: { voucherToken: { type: 'string' }, siteId: { type: 'string' } } }, outputSchema: {}, handler: async ({ voucherToken, siteId }, context) => assertTenant(await providerCall(providerFrom(context, 'voucher'), 'validate', { voucherToken, siteId, scope: scopeFrom(context) }), context.tenantId) }),
    defineTool({ name: 'voucher.redeem', description: 'Redeem an eligible voucher idempotently into an entitlement.', specialist: 'voucher', permissions: ['voucher:write'], ticketTypes: ['voucher-redemption'], risk: 'high', parameters: { type: 'object', required: ['voucherToken', 'idempotencyKey'], properties: { voucherToken: { type: 'string' }, idempotencyKey: { type: 'string' }, userId: { type: 'string' }, siteId: { type: 'string' } } }, outputSchema: {}, handler: async (args, context) => { const proposal = approvalOrProposal('voucher.redeem', args, context, { risk: 'high' }); if (proposal) return proposal; return assertTenant(await providerCall(providerFrom(context, 'voucher'), 'redeem', { ...args, scope: scopeFrom(context) }), context.tenantId); } }),
    defineTool({ name: 'voucher.revoke', description: 'Propose or revoke an entitlement with an auditable reason.', specialist: 'voucher', permissions: ['voucher:write'], ticketTypes: ['voucher-revocation'], risk: 'high', parameters: { type: 'object', required: ['voucherId', 'reason'], properties: { voucherId: { type: 'string' }, reason: { type: 'string' }, idempotencyKey: { type: 'string' } } }, outputSchema: {}, handler: async (args, context) => { const proposal = approvalOrProposal('voucher.revoke', args, context, { risk: 'high' }); if (proposal) return proposal; return assertTenant(await providerCall(providerFrom(context, 'voucher'), 'revoke', { ...args, scope: scopeFrom(context) }), context.tenantId); } }),
  ],
});

export { voucherSkill };
export default voucherSkill;
