/**
 * Canonical request context shared by browser/PWA, CLI and future channels.
 * Authentication remains provider-specific; the domain receives only a
 * normalized identity and channel context.
 */

export function createRequestContext({ user = null, profile = null, headers = {}, client = null } = {}) {
  const authorization = headers.authorization || headers.Authorization || '';
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || null;
  const source = client || headers['x-agentos-client'] || headers['X-AgentOS-Client'] || 'unknown';

  return Object.freeze({
    authenticated: Boolean(user?.id || user?.uid || bearer),
    userId: user?.id || user?.uid || profile?.id || null,
    userUuid: user?.id || user?.uid || profile?.id || null,
    email: user?.email || profile?.email || null,
    role: profile?.role || user?.role || null,
    roles: [...new Set([...(profile?.roles || []), ...(user?.roles || []), profile?.role, user?.role].filter(Boolean))],
    tenantId: profile?.tenant_id || profile?.tenantId || null,
    siteId: profile?.site_id || profile?.siteId || null,
    domain: profile?.domain || null,
    domainIds: [...new Set([...(profile?.domains || []), profile?.domain].filter(Boolean))],
    scopes: [...new Set([...(profile?.scopes || []), ...(user?.scopes || [])])],
    client: String(source).toLowerCase(),
    tokenPresent: Boolean(bearer),
  });
}

export function resourceContext(requestContext, resource = null) {
  return Object.freeze({
    ...requestContext,
    resourceType: resource?.resourceType || null,
    resourceId: resource?.resourceId || null,
    catalogTable: resource?.catalogTable || null,
    inventoryTable: resource?.inventoryTable || null,
  });
}
