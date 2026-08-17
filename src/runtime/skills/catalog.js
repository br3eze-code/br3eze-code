import { defineSkill, defineTool } from '../skill.js';

function scopeFrom(context = {}) {
  const tenantId = context.tenantId || context.scope?.tenantId;
  const userId = context.userId || context.scope?.userId;
  if (!tenantId || !userId) throw new Error('Catalog tools require tenantId and userId');
  return { tenantId, userId, siteId: context.siteId || context.scope?.siteId || null };
}

function providerFrom(context = {}) {
  const provider = context.catalog || context.services?.catalog || context.productQueryService;
  if (!provider) throw new Error('Catalog provider is not configured');
  return provider;
}

function assertTenant(result, tenantId) {
  if (result && result.tenantId && result.tenantId !== tenantId) {
    throw new Error('Catalog result is outside the authorized tenant scope');
  }
  return result;
}

function approvalOrProposal(action, args, context) {
  const approval = context.approval || {};
  if (approval.granted === true && approval.action === action && approval.tenantId === context.tenantId) return null;
  return { status: 'approval_required', action, tenantId: context.tenantId, proposal: args, approvalRequired: true };
}

const catalogSkill = defineSkill({
  name: 'catalog',
  description: 'Versioned product, SKU, plan, offer, eligibility, and publication operations.',
  specialist: 'catalog',
  permissions: ['catalog:read'],
  ticketTypes: ['product-inquiry', 'catalog-validation', 'catalog-publication'],
  persona: 'Catalog Specialist: own product definitions and compatibility without silently changing price, inventory, orders, vouchers, or fulfillment.',
  tools: [
    defineTool({
      name: 'catalog.search',
      description: 'Search tenant-scoped products through the provider-neutral SQL/Firebase catalog service.',
      specialist: 'catalog',
      permissions: ['catalog:read'],
      ticketTypes: ['product-inquiry', 'catalog-validation'],
      parameters: { type: 'object', properties: { name: { type: 'string' }, brand: { type: 'string' }, sku: { type: 'string' }, category: { type: 'string' }, tier: { type: 'string' }, availability: { type: 'string' }, limit: { type: 'integer', maximum: 100 }, include: { type: 'array', items: { type: 'string' } } } },
      outputSchema: { type: 'object' },
      handler: async (filters = {}, context = {}) => {
        const scope = scopeFrom(context);
        const result = await providerFrom(context).search({ scope, filters, include: filters.include, viewerRole: context.role || context.agentRole, viewerTier: context.viewerTier, purpose: 'product_inquiry' });
        if (Array.isArray(result?.items)) result.items = result.items.map((item) => assertTenant(item, scope.tenantId));
        return assertTenant(result, scope.tenantId);
      },
    }),
    defineTool({
      name: 'catalog.get',
      description: 'Read one tenant-scoped product or catalog version.',
      specialist: 'catalog',
      permissions: ['catalog:read'],
      ticketTypes: ['product-inquiry', 'catalog-validation'],
      parameters: { type: 'object', required: ['productId'], properties: { productId: { type: 'string' }, version: { type: 'string' } } },
      outputSchema: { type: 'object' },
      handler: async ({ productId, version }, context = {}) => {
        const scope = scopeFrom(context);
        const provider = providerFrom(context);
        const result = typeof provider.get === 'function'
          ? await provider.get({ productId, version, scope })
          : await provider.search({ scope, filters: { sku: productId, limit: 1 }, purpose: 'product_inquiry' });
        return assertTenant(result, scope.tenantId);
      },
    }),
    defineTool({
      name: 'catalog.validate',
      description: 'Validate a product definition, stable identifiers, lifecycle, and compatibility metadata.',
      specialist: 'catalog',
      permissions: ['catalog:read'],
      ticketTypes: ['catalog-validation', 'catalog-publication'],
      parameters: { type: 'object', required: ['product'], properties: { product: { type: 'object' } } },
      outputSchema: { type: 'object', required: ['valid', 'tenantId', 'errors'] },
      handler: async ({ product }, context = {}) => {
        const scope = scopeFrom(context);
        if (!product || typeof product !== 'object') throw new Error('product is required');
        if (product.tenantId && product.tenantId !== scope.tenantId) throw new Error('Product is outside the authorized tenant scope');
        const errors = [];
        for (const field of ['id', 'name', 'version', 'lifecycle']) if (!product[field]) errors.push(`${field} is required`);
        if (product.lifecycle && !['draft', 'review', 'published', 'retired', 'archived'].includes(product.lifecycle)) errors.push('lifecycle is invalid');
        return { valid: errors.length === 0, tenantId: scope.tenantId, errors, product: { ...product, tenantId: scope.tenantId } };
      },
    }),
    defineTool({
      name: 'catalog.publish',
      description: 'Propose or execute publication of an approved catalog version without changing price or inventory.',
      specialist: 'catalog',
      permissions: ['catalog:write'],
      ticketTypes: ['catalog-publication'],
      risk: 'high',
      parameters: { type: 'object', required: ['productId', 'version', 'compatibilityPlan'], properties: { productId: { type: 'string' }, version: { type: 'string' }, compatibilityPlan: { type: 'string' }, effectiveAt: { type: 'string' }, evidenceRefs: { type: 'array', items: { type: 'string' } } } },
      outputSchema: { type: 'object' },
      handler: async (args = {}, context = {}) => {
        const scope = scopeFrom(context);
        const proposal = approvalOrProposal('catalog.publish', args, context);
        if (proposal) return proposal;
        const provider = providerFrom(context);
        if (typeof provider.publish !== 'function') throw new Error('Catalog provider does not support publication');
        return assertTenant(await provider.publish({ ...args, scope }), scope.tenantId);
      },
    }),
  ],
});

export { catalogSkill };
export default catalogSkill;
