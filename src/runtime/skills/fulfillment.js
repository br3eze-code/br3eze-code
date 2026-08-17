import { defineSkill, defineTool } from '../skill.js';
import { scopeFrom, providerFrom, assertTenant, approvalOrProposal, providerCall } from './commerce-helpers.js';

const fulfillmentSkill = defineSkill({
  name: 'fulfillment',
  description: 'Tenant-scoped shipment tracking, provider evidence, delivery reconciliation, and exceptions.',
  specialist: 'fulfillment',
  permissions: ['fulfillment:read'],
  ticketTypes: ['shipment-tracking', 'fulfillment-reconciliation', 'delivery-exception'],
  persona: 'Fulfillment Expeditor: preserve provider evidence, quantify variance, and close only with verified resolution evidence.',
  tools: [
    defineTool({ name: 'fulfillment.track', description: 'Retrieve tenant-scoped shipment tracking and provider evidence.', specialist: 'fulfillment', permissions: ['fulfillment:read'], ticketTypes: ['shipment-tracking'], parameters: { type: 'object', required: ['shipmentId'], properties: { shipmentId: { type: 'string' }, trackingId: { type: 'string' } } }, outputSchema: {}, handler: async (args, context) => assertTenant(await providerCall(providerFrom(context, 'fulfillment'), 'track', { ...args, scope: scopeFrom(context) }), context.tenantId) }),
    defineTool({ name: 'fulfillment.reconcile', description: 'Reconcile provider events with the internal delivery timeline.', specialist: 'fulfillment', permissions: ['fulfillment:write'], ticketTypes: ['fulfillment-reconciliation'], parameters: { type: 'object', required: ['shipmentId', 'events'], properties: { shipmentId: { type: 'string' }, events: { type: 'array' }, evidenceRefs: { type: 'array', items: { type: 'string' } } } }, outputSchema: {}, handler: async (args, context) => assertTenant(await providerCall(providerFrom(context, 'fulfillment'), 'reconcile', { ...args, scope: scopeFrom(context) }), context.tenantId) }),
    defineTool({ name: 'fulfillment.exception', description: 'Create or propose a delivery exception recovery action.', specialist: 'fulfillment', permissions: ['fulfillment:write'], ticketTypes: ['delivery-exception'], risk: 'high', parameters: { type: 'object', required: ['shipmentId', 'classification', 'impact'], properties: { shipmentId: { type: 'string' }, classification: { type: 'string' }, impact: { type: 'object' }, recovery: { type: 'object' }, evidenceRefs: { type: 'array', items: { type: 'string' } } } }, outputSchema: {}, handler: async (args, context) => { const proposal = approvalOrProposal('fulfillment.exception', args, context, { risk: 'high' }); if (proposal) return proposal; return assertTenant(await providerCall(providerFrom(context, 'fulfillment'), 'exception', { ...args, scope: scopeFrom(context) }), context.tenantId); } }),
  ],
});

export { fulfillmentSkill };
export default fulfillmentSkill;
