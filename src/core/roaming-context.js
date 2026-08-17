export class RoamingContextError extends Error {
  constructor(message, code = 'ROAMING_CONTEXT_INVALID') {
    super(message);
    this.name = 'RoamingContextError';
    this.code = code;
    this.status = 403;
  }
}

function asList(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [String(value)];
}

function assertAuthorized(value, allowed, field) {
  if (!value) return null;
  if (allowed.length > 0 && !allowed.includes(String(value))) {
    throw new RoamingContextError(`${field} is outside the authorized scope`, 'ROAMING_SCOPE_DENIED');
  }
  return String(value);
}

function assertNotExpired(expiresAt, now) {
  if (!expiresAt) return;
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp) || timestamp <= now()) {
    throw new RoamingContextError('The active roaming selection has expired', 'ROAMING_SELECTION_EXPIRED');
  }
}

export function resolveRoamingContext({ context = {}, selection = {}, now = () => Date.now() } = {}) {
  const authorizedTenantIds = asList(context.authorizedTenantIds || context.tenantIds || context.scopes?.tenantIds);
  const authorizedSiteIds = asList(context.authorizedSiteIds || context.siteIds || context.scopes?.siteIds);
  const authorizedNodeIds = asList(context.authorizedNodeIds || context.nodeIds || context.scopes?.nodeIds);
  const activeTenantId = assertAuthorized(selection.tenantId || selection.activeTenantId || selection.selectedTenantId || context.activeTenantId || context.tenantId, authorizedTenantIds, 'tenantId');
  const activeSiteId = assertAuthorized(selection.siteId || selection.activeSiteId || selection.selectedSiteId || context.activeSiteId || context.siteId, authorizedSiteIds, 'siteId');
  const activeNodeId = assertAuthorized(selection.nodeId || selection.routerId || selection.activeNodeId || selection.selectedNodeId || context.activeNodeId || context.nodeId, authorizedNodeIds, 'nodeId');
  const selectionExpiresAt = selection.expiresAt || context.selectionExpiresAt || null;
  assertNotExpired(selectionExpiresAt, now);

  if (authorizedTenantIds.length > 1 && !activeTenantId) {
    throw new RoamingContextError('An active tenant selection is required', 'ROAMING_TENANT_SELECTION_REQUIRED');
  }
  if (authorizedSiteIds.length > 1 && !activeSiteId) {
    throw new RoamingContextError('An active site selection is required', 'ROAMING_SITE_SELECTION_REQUIRED');
  }
  if (authorizedNodeIds.length > 1 && !activeNodeId) {
    throw new RoamingContextError('An active router selection is required', 'ROAMING_NODE_SELECTION_REQUIRED');
  }

  return {
    activeTenantId,
    activeSiteId,
    activeNodeId,
    roamingSessionId: selection.roamingSessionId || context.roamingSessionId || null,
    selectionSource: selection.source || context.selectionSource || 'channel',
    selectionExpiresAt,
    tenantId: activeTenantId || context.tenantId || null,
    siteId: activeSiteId || context.siteId || null,
    nodeId: activeNodeId || context.nodeId || null,
    authorizedTenantIds,
    authorizedSiteIds,
    authorizedNodeIds
  };
}

export default resolveRoamingContext;
