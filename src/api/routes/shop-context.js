/**
 * Resolve the trusted commerce context for user-facing shop routes.
 *
 * Security invariant:
 * - Firebase uid is the buyer identity.
 * - tenant/site/domain scope comes from authenticated identity/claims.
 * - a client-supplied channelId is never treated as proof of ownership.
 * - user-facing carts are canonically bound to the authenticated uid.
 */
function contextError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function readIdentity(req) {
  const user = req.firebaseUser || {};
  const claims = user.customClaims || {};
  return {
    uid: user.uid || null,
    role: user.role || claims.role || 'user',
    tenantId: user.tenantId || claims.tenantId || null,
    siteId: user.siteId || claims.siteId || null,
    domain: user.domain || user.domainId || claims.domain || claims.domainId || null,
  };
}

export function resolveCommerceContext(req, { requireTenant = true } = {}) {
  const identity = readIdentity(req);
  if (!identity.uid) throw contextError('Firebase identity required', 401);
  if (requireTenant && !identity.tenantId) throw contextError('Tenant scope required', 403);

  const body = req.body || {};
  const query = req.query || {};
  const requestedPlatform = body.platform ?? query.platform ?? 'web';
  const platform = String(requestedPlatform).trim();
  if (!platform) throw contextError('platform required', 400);

  const requestedChannelId = body.channelId ?? query.channelId ?? null;
  const channelId = String(identity.uid);

  return {
    uid: String(identity.uid),
    buyerId: String(identity.uid),
    merchantId: identity.tenantId ? String(identity.tenantId) : null,
    platform,
    channelId,
    requestedChannelId: requestedChannelId == null ? null : String(requestedChannelId),
    scope: {
      tenantId: identity.tenantId,
      siteId: identity.siteId,
      domain: identity.domain,
    },
    role: identity.role,
  };
}

export default resolveCommerceContext;
