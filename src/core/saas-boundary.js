/**
 * Domain-neutral SaaS control-plane boundary.
 *
 * The kernel knows tenancy, membership, entitlements and metering semantics;
 * adapters provide persistence and payment/provider implementations.
 * No product, network, commerce or vendor assumptions belong here.
 */

const ACCOUNT_STATES = Object.freeze(['trialing', 'active', 'past_due', 'suspended', 'cancelled']);

function requireId(value, name) {
  if (!value || typeof value !== 'string') throw new TypeError(`${name} is required`);
  return value;
}

export function createTenantContext({ tenantId, userId, role = 'member', siteId = null, memberships = [], entitlements = [], accountState = 'active' } = {}) {
  requireId(tenantId, 'tenantId');
  requireId(userId, 'userId');
  if (!ACCOUNT_STATES.includes(accountState)) throw new Error(`invalid account state: ${accountState}`);
  const member = memberships.find((item) => item?.tenantId === tenantId && item?.userId === userId) || null;
  if (memberships.length && !member) throw new Error('tenant membership required');
  if (member?.status && member.status !== 'active') throw new Error('tenant membership is not active');
  return Object.freeze({
    tenantId,
    userId,
    role: member?.role || role,
    siteId,
    accountState,
    entitlements: [...new Set(entitlements.map(String))],
  });
}

export function assertTenantScope(context, resource = {}) {
  if (!context?.tenantId || !context?.userId) throw new Error('authenticated tenant context required');
  if (resource.tenantId && resource.tenantId !== context.tenantId) throw new Error('tenant scope violation');
  if (resource.siteId && context.siteId && resource.siteId !== context.siteId) throw new Error('site scope violation');
  return true;
}

export function assertEntitlement(context, entitlement) {
  requireId(entitlement, 'entitlement');
  if (!context?.entitlements?.includes(entitlement) && !context?.entitlements?.includes('*')) {
    throw new Error(`entitlement required: ${entitlement}`);
  }
  return true;
}

export function recordUsage({ tenantId, metric, quantity = 1, unit = 'count', occurredAt = Date.now(), idempotencyKey = null } = {}) {
  requireId(tenantId, 'tenantId');
  requireId(metric, 'metric');
  if (!Number.isFinite(quantity) || quantity < 0) throw new TypeError('usage quantity must be a non-negative finite number');
  return Object.freeze({ tenantId, metric, quantity, unit, occurredAt, idempotencyKey });
}

export function normalizeSubscription(subscription = {}) {
  requireId(subscription.tenantId, 'subscription.tenantId');
  requireId(subscription.planId, 'subscription.planId');
  if (subscription.status && !ACCOUNT_STATES.includes(subscription.status)) throw new Error(`invalid subscription status: ${subscription.status}`);
  return Object.freeze({
    tenantId: subscription.tenantId,
    planId: subscription.planId,
    status: subscription.status || 'active',
    currency: subscription.currency || null,
    currentPeriodStart: subscription.currentPeriodStart || null,
    currentPeriodEnd: subscription.currentPeriodEnd || null,
    providerCustomerId: subscription.providerCustomerId || null,
    providerSubscriptionId: subscription.providerSubscriptionId || null,
  });
}

export { ACCOUNT_STATES };
export default { ACCOUNT_STATES, createTenantContext, assertTenantScope, assertEntitlement, recordUsage, normalizeSubscription };
