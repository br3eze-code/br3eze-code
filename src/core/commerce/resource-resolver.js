/**
 * Domain-neutral commerce resource resolver.
 * Authenticated channels (PWA, CLI, bots, API clients) identify the caller;
 * this layer identifies what is being sold and where its inventory lives.
 *
 * Product and service inventory intentionally remain separate persistence
 * domains. Callers never need to know table/collection names.
 */

export const RESOURCE_TYPES = Object.freeze({ PRODUCT: 'product', SERVICE: 'service' });

const RESOURCE_DEFINITIONS = Object.freeze({
  product: Object.freeze({ type: 'product', catalogTable: 'products', inventoryTable: 'product_inventory', identityFields: ['productId', 'sku', 'id'] }),
  service: Object.freeze({ type: 'service', catalogTable: 'services', inventoryTable: 'service_inventory', identityFields: ['serviceId', 'serviceCode', 'id'] }),
});

export function normalizeResourceType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (['product', 'products', 'physical', 'goods'].includes(type)) return RESOURCE_TYPES.PRODUCT;
  if (['service', 'services', 'subscription', 'digital'].includes(type)) return RESOURCE_TYPES.SERVICE;
  return null;
}

export function getResourceDefinition(type) {
  const normalized = normalizeResourceType(type);
  if (!normalized) throw new Error(`Unsupported commerce resource type: ${type}`);
  return RESOURCE_DEFINITIONS[normalized];
}

export function resolveResourceRef(input = {}) {
  const type = normalizeResourceType(input.resourceType || input.type || input.kind);
  const definition = getResourceDefinition(type);
  const identity = definition.identityFields.map(field => input[field]).find(value => value !== undefined && value !== null && String(value).trim() !== '');
  if (!identity) throw new Error(`${type} reference requires ${definition.identityFields.join(', ')}`);
  return Object.freeze({
    resourceType: definition.type,
    resourceId: String(identity),
    catalogTable: definition.catalogTable,
    inventoryTable: definition.inventoryTable,
    quantity: Number.isFinite(Number(input.quantity)) ? Number(input.quantity) : 1,
    tenantId: input.tenantId || input.tenant || null,
    siteId: input.siteId || null,
    domain: input.domain || null,
  });
}

export function classifyCommerceRequest(input = {}) {
  const explicit = normalizeResourceType(input.resourceType || input.type || input.kind);
  if (explicit) return resolveResourceRef({ ...input, resourceType: explicit });
  if (input.serviceId || input.serviceCode) return resolveResourceRef({ ...input, resourceType: 'service' });
  if (input.productId || input.sku) return resolveResourceRef({ ...input, resourceType: 'product' });
  return null;
}

export function inventoryTableFor(type) { return getResourceDefinition(type).inventoryTable; }
