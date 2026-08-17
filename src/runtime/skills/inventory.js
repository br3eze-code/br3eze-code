import { defineSkill, defineTool } from '../skill.js';

function scopeFrom(context = {}) {
  const tenantId = context.tenantId || context.scope?.tenantId;
  const userId = context.userId || context.scope?.userId;
  if (!tenantId || !userId) throw new Error('Inventory tools require tenantId and userId');
  return { tenantId, userId, siteId: context.siteId || context.scope?.siteId || null };
}

function providerFrom(context = {}) {
  const provider = context.inventory || context.services?.inventory;
  if (!provider) throw new Error('Inventory provider is not configured');
  return provider;
}

function assertTenant(result, tenantId) {
  if (result && result.tenantId && result.tenantId !== tenantId) {
    throw new Error('Inventory result is outside the authorized tenant scope');
  }
  return result;
}

function approvalOrProposal(action, args, context) {
  const approval = context.approval || {};
  if (approval.granted === true && approval.action === action && approval.tenantId === context.tenantId) return null;
  return {
    status: 'approval_required',
    action,
    tenantId: context.tenantId,
    proposal: args,
    approvalRequired: true,
  };
}

const inventorySkill = defineSkill({
  name: 'inventory',
  description: 'Scoped stock, capacity, availability, reservation, and reconciliation operations.',
  specialist: 'inventory',
  permissions: ['inventory:read'],
  ticketTypes: ['reserve-stock', 'release-stock', 'adjust-stock', 'transfer-stock', 'reconcile-stock'],
  persona: 'Inventory Specialist: verify availability, reserve atomically, preserve evidence, and never promise unreserved stock.',
  tools: [
    defineTool({
      name: 'inventory.search',
      description: 'Search tenant-scoped inventory by SKU, product, site, or availability.',
      specialist: 'inventory',
      permissions: ['inventory:read'],
      ticketTypes: ['inventory-inquiry', 'reserve-stock', 'reconcile-stock'],
      parameters: { type: 'object', properties: { query: { type: 'string' }, sku: { type: 'string' }, siteId: { type: 'string' }, availability: { type: 'string' }, limit: { type: 'integer', maximum: 100 } } },
      outputSchema: {},
      handler: async (args = {}, context = {}) => {
        const scope = { ...scopeFrom(context), siteId: args.siteId || scopeFrom(context).siteId };
        const result = await providerFrom(context).search({ ...args, scope });
        return Array.isArray(result) ? result.map((item) => assertTenant(item, scope.tenantId)) : assertTenant(result, scope.tenantId);
      },
    }),
    defineTool({
      name: 'inventory.get',
      description: 'Read one tenant-scoped inventory item with freshness and reservation state.',
      specialist: 'inventory',
      permissions: ['inventory:read'],
      ticketTypes: ['inventory-inquiry', 'reserve-stock'],
      parameters: { type: 'object', required: ['itemId'], properties: { itemId: { type: 'string' }, siteId: { type: 'string' } } },
      outputSchema: {},
      handler: async ({ itemId, siteId }, context = {}) => {
        const scope = { ...scopeFrom(context), siteId: siteId || scopeFrom(context).siteId };
        return assertTenant(await providerFrom(context).get({ itemId, scope }), scope.tenantId);
      },
    }),
    defineTool({
      name: 'inventory.reserve',
      description: 'Propose or execute an idempotent inventory reservation with expiry.',
      specialist: 'inventory',
      permissions: ['inventory:write'],
      ticketTypes: ['reserve-stock'],
      risk: 'medium',
      parameters: { type: 'object', required: ['itemId', 'quantity', 'idempotencyKey'], properties: { itemId: { type: 'string' }, quantity: { type: 'number', minimum: 1 }, orderId: { type: 'string' }, idempotencyKey: { type: 'string' }, expiresAt: { type: 'string' } } },
      outputSchema: {},
      handler: async (args = {}, context = {}) => {
        const scope = scopeFrom(context);
        const proposal = approvalOrProposal('inventory.reserve', args, context);
        if (proposal) return proposal;
        return assertTenant(await providerFrom(context).reserve({ ...args, scope }), scope.tenantId);
      },
    }),
    defineTool({
      name: 'inventory.release',
      description: 'Release an approved reservation using its idempotency key.',
      specialist: 'inventory',
      permissions: ['inventory:write'],
      ticketTypes: ['release-stock'],
      risk: 'medium',
      parameters: { type: 'object', required: ['reservationId', 'idempotencyKey'], properties: { reservationId: { type: 'string' }, idempotencyKey: { type: 'string' }, reason: { type: 'string' } } },
      outputSchema: {},
      handler: async (args = {}, context = {}) => {
        const scope = scopeFrom(context);
        const proposal = approvalOrProposal('inventory.release', args, context);
        if (proposal) return proposal;
        return assertTenant(await providerFrom(context).release({ ...args, scope }), scope.tenantId);
      },
    }),
    defineTool({
      name: 'inventory.adjust',
      description: 'Propose or execute an approved manual stock adjustment with evidence.',
      specialist: 'inventory',
      permissions: ['inventory:write'],
      ticketTypes: ['adjust-stock', 'reconcile-stock'],
      risk: 'high',
      parameters: { type: 'object', required: ['itemId', 'quantityDelta', 'reason', 'evidenceRefs'], properties: { itemId: { type: 'string' }, quantityDelta: { type: 'number' }, reason: { type: 'string' }, evidenceRefs: { type: 'array', items: { type: 'string' } } } },
      outputSchema: {},
      handler: async (args = {}, context = {}) => {
        const scope = scopeFrom(context);
        const proposal = approvalOrProposal('inventory.adjust', args, context);
        if (proposal) return proposal;
        return assertTenant(await providerFrom(context).adjust({ ...args, scope }), scope.tenantId);
      },
    }),
    defineTool({
      name: 'inventory.transfer',
      description: 'Propose or execute an approved stock transfer between authorized sites.',
      specialist: 'inventory',
      permissions: ['inventory:write'],
      ticketTypes: ['transfer-stock'],
      risk: 'high',
      parameters: { type: 'object', required: ['itemId', 'quantity', 'fromSiteId', 'toSiteId', 'idempotencyKey'], properties: { itemId: { type: 'string' }, quantity: { type: 'number', minimum: 1 }, fromSiteId: { type: 'string' }, toSiteId: { type: 'string' }, idempotencyKey: { type: 'string' }, evidenceRefs: { type: 'array', items: { type: 'string' } } } },
      outputSchema: {},
      handler: async (args = {}, context = {}) => {
        const scope = scopeFrom(context);
        const proposal = approvalOrProposal('inventory.transfer', args, context);
        if (proposal) return proposal;
        const provider = providerFrom(context);
        if (typeof provider.transfer !== 'function') throw new Error('Inventory provider does not support transfer');
        return assertTenant(await provider.transfer({ ...args, scope }), scope.tenantId);
      },
    }),
    defineTool({
      name: 'inventory.lowStock',
      description: 'Find tenant-scoped items below a configured threshold.',
      specialist: 'inventory',
      permissions: ['inventory:read'],
      ticketTypes: ['replenishment-review', 'reconcile-stock'],
      parameters: { type: 'object', properties: { threshold: { type: 'number', minimum: 0 }, siteId: { type: 'string' } } },
      outputSchema: {},
      handler: async ({ threshold = 0, siteId }, context = {}) => {
        const scope = { ...scopeFrom(context), siteId: siteId || scopeFrom(context).siteId };
        const result = await providerFrom(context).lowStock({ threshold, scope });
        return Array.isArray(result) ? result.map((item) => assertTenant(item, scope.tenantId)) : assertTenant(result, scope.tenantId);
      },
    }),
  ],
});

export { inventorySkill };
export default inventorySkill;
