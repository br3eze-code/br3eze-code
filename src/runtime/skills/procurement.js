import { defineSkill, defineTool } from '../skill.js';
import { scopeFrom, providerFrom, assertTenant, approvalOrProposal, providerCall } from './commerce-helpers.js';

const procurementSkill = defineSkill({
  name: 'procurement',
  description: 'Tenant-scoped supplier discovery, quote comparison, re-tendering, and purchase proposals.',
  specialist: 'procurement',
  permissions: ['procurement:read'],
  ticketTypes: ['supplier-search', 'quote-comparison', 'purchase-proposal'],
  persona: 'Procurement Specialist: compare evidenced supplier options and never convert a recommendation into commitment without approval.',
  tools: [
    defineTool({ name: 'procurement.search', description: 'Search verified suppliers within tenant and project scope.', specialist: 'procurement', permissions: ['procurement:read'], ticketTypes: ['supplier-search'], parameters: { type: 'object', required: ['requirement'], properties: { requirement: { type: 'object' }, market: { type: 'string' } } }, outputSchema: {}, handler: async (args, context) => assertTenant(await providerCall(providerFrom(context, 'procurement'), 'search', { ...args, scope: scopeFrom(context) }), context.tenantId) }),
    defineTool({ name: 'procurement.compare', description: 'Compare supplier quotes with price, capacity, quality, terms, and evidence.', specialist: 'procurement', permissions: ['procurement:read'], ticketTypes: ['quote-comparison'], parameters: { type: 'object', required: ['quotes'], properties: { quotes: { type: 'array' }, criteria: { type: 'object' }, evidenceRefs: { type: 'array', items: { type: 'string' } } } }, outputSchema: {}, handler: async (args, context) => assertTenant(await providerCall(providerFrom(context, 'procurement'), 'compare', { ...args, scope: scopeFrom(context) }), context.tenantId) }),
    defineTool({ name: 'procurement.propose', description: 'Propose an evidenced purchase or recovery option for approval.', specialist: 'procurement', permissions: ['procurement:write'], ticketTypes: ['purchase-proposal'], risk: 'high', parameters: { type: 'object', required: ['supplierId', 'scope', 'totalCost', 'currency'], properties: { supplierId: { type: 'string' }, scope: { type: 'object' }, totalCost: { type: 'integer', minimum: 0 }, currency: { type: 'string' }, evidenceRefs: { type: 'array', items: { type: 'string' } }, idempotencyKey: { type: 'string' } } }, outputSchema: {}, handler: async (args, context) => { const proposal = approvalOrProposal('procurement.propose', args, context, { risk: 'high' }); if (proposal) return proposal; return assertTenant(await providerCall(providerFrom(context, 'procurement'), 'propose', { ...args, scope: scopeFrom(context) }), context.tenantId); } }),
  ],
});

export { procurementSkill };
export default procurementSkill;
