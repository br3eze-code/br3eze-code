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
    defineTool({
      name: 'procurement.product-reference',
      description: 'Retrieve a tenant-scoped product supplier reference URL and procurement metadata; the URL is reference-only and is never used as an API endpoint.',
      specialist: 'procurement',
      permissions: ['procurement:read'],
      ticketTypes: ['supplier-search'],
      parameters: { type: 'object', required: ['productId'], properties: { productId: { type: 'string' } } },
      outputSchema: { type: 'object' },
      handler: async ({ productId }, context = {}) => {
        const scope = scopeFrom(context);
        const result = await providerCall(providerFrom(context, 'supplierCatalog'), 'getSupplierReference', { productId, scope });
        return assertTenant(result, scope.tenantId);
      },
    }),
    defineTool({
      name: 'procurement.provision-product',
      description: 'Create a supplier purchase order to restock a catalog product. Without matching persisted approval this returns a proposal and must not call the supplier.',
      specialist: 'procurement',
      permissions: ['procurement:write'],
      ticketTypes: ['purchase-proposal'],
      risk: 'high',
      parameters: { type: 'object', required: ['productId', 'quantity', 'idempotencyKey'], properties: { productId: { type: 'string' }, quantity: { type: 'integer', minimum: 1, maximum: 100000 }, idempotencyKey: { type: 'string', minLength: 1, maxLength: 200 } } },
      outputSchema: { type: 'object' },
      handler: async (args, context = {}) => {
        const scope = scopeFrom(context);
        if (!scope.projectId) throw new Error('Supplier provisioning requires projectId in the authenticated agent context');
        const approval = context.approval || {};
        const action = 'purchase.order';
        if (approval.status !== 'APPROVED' || !approval.approvalId || approval.tenantId !== scope.tenantId || approval.projectId !== scope.projectId || approval.action !== action) {
          return { status: 'approval_required', action, tenantId: scope.tenantId, projectId: scope.projectId, proposal: args, approvalRequired: true, externalSupplierCalled: false };
        }
        const result = await providerCall(providerFrom(context, 'supplierProvisioning'), 'provisionProduct', { ...args, scope, approval });
        return assertTenant(result, scope.tenantId);
      },
    }),
  ],
});

export { procurementSkill };
export default procurementSkill;
