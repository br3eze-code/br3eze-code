import { defineSkill, defineTool } from '../skill.js';
import { scopeFrom, providerFrom, assertTenant, approvalOrProposal, providerCall } from './commerce-helpers.js';

const pricingSkill = defineSkill({
  name: 'pricing',
  description: 'Versioned tenant-scoped prices, discounts, taxes, credits, and promotions.',
  specialist: 'pricing',
  permissions: ['pricing:read'],
  ticketTypes: ['price-calculation', 'pricing-validation', 'pricing-publication'],
  persona: 'Pricing Specialist: calculate deterministic commercial rules without charging or mutating the ledger.',
  tools: [
    defineTool({ name: 'pricing.calculate', description: 'Calculate a tenant-scoped price using minor units and explicit currency.', specialist: 'pricing', permissions: ['pricing:read'], ticketTypes: ['price-calculation'], parameters: { type: 'object', required: ['items', 'currency'], properties: { items: { type: 'array' }, currency: { type: 'string', minLength: 3 }, discount: { type: 'number', minimum: 0 }, taxRate: { type: 'number', minimum: 0 } } }, outputSchema: {}, handler: async (args, context) => assertTenant(await providerCall(providerFrom(context, 'pricing'), 'calculate', { ...args, scope: scopeFrom(context) }), context.tenantId) }),
    defineTool({ name: 'pricing.validate', description: 'Validate a price or promotion rule for scope, rounding, eligibility, and effective dates.', specialist: 'pricing', permissions: ['pricing:read'], ticketTypes: ['pricing-validation'], parameters: { type: 'object', required: ['rule'], properties: { rule: { type: 'object' }, currency: { type: 'string' } } }, outputSchema: {}, handler: async ({ rule, currency }, context) => assertTenant(await providerCall(providerFrom(context, 'pricing'), 'validate', { rule, currency, scope: scopeFrom(context) }), context.tenantId) }),
    defineTool({ name: 'pricing.publish', description: 'Propose or publish an approved versioned pricing rule.', specialist: 'pricing', permissions: ['pricing:write'], ticketTypes: ['pricing-publication'], risk: 'high', parameters: { type: 'object', required: ['rule', 'idempotencyKey'], properties: { rule: { type: 'object' }, idempotencyKey: { type: 'string' }, effectiveAt: { type: 'string' } } }, outputSchema: {}, handler: async (args, context) => { const proposal = approvalOrProposal('pricing.publish', args, context, { risk: 'high' }); if (proposal) return proposal; return assertTenant(await providerCall(providerFrom(context, 'pricing'), 'publish', { ...args, scope: scopeFrom(context) }), context.tenantId); } }),
  ],
});

export { pricingSkill };
export default pricingSkill;
