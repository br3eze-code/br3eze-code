/**
 * Server identity boundary.
 *
 * Interactive identities are issued by Supabase Auth. Google, GitHub,
 * Microsoft/Azure, Apple and other configured OAuth providers are federated
 * by Supabase; this server only verifies the resulting access token.
 * Firebase Admin remains available to legacy Firestore data adapters, not
 * as a competing user identity provider.
 */
import crypto from 'crypto';

const ROLE_PERMISSIONS = Object.freeze({
  ADMIN: ['*'],
  PARTNER: ['inventory.read', 'orders.read', 'orders.create', 'payments.read', 'vouchers.read'],
  CASHIER: ['orders.read', 'orders.create', 'payments.create', 'vouchers.read', 'vouchers.create'],
  PROCUREMENT: ['catalog:read', 'procurement:read', 'procurement:write', 'inventory.read'],
  USER: ['profile.read', 'profile.update', 'orders.create', 'payments.create']
});

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function normalizeIdentity(decoded, provider = 'supabase') {
  const roles = Array.isArray(decoded.roles)
    ? decoded.roles.map(String).map(role => role.toUpperCase())
    : [String(decoded.role || 'USER').toUpperCase()];
  const uniqueRoles = [...new Set(roles)];
  const permissions = [...new Set(uniqueRoles.flatMap(role => ROLE_PERMISSIONS[role] || []))];

  return Object.freeze({
    id: decoded.uid || decoded.sub || null,
    provider,
    email: decoded.email || null,
    name: decoded.name || decoded.email || null,
    roles: uniqueRoles,
    permissions,
    authenticatedAt: new Date().toISOString(),
    metadata: { emailVerified: Boolean(decoded.email_verified) }
  });
}

async function authenticateSupabaseBearer(token) {
  const baseUrl = String(process.env.SUPABASE_URL || '').replace(/\\/$/, '');
  const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || '';
  if (!baseUrl || !apiKey || typeof fetch !== 'function') return null;

  try {
    const response = await fetch(`${baseUrl}/auth/v1/user`, {
      headers: { apikey: apiKey, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return null;
    const user = await response.json();
    if (!user?.id) return null;

    // Only server-controlled app_metadata can grant roles or tenant scope.
    const metadata = user.app_metadata || {};
    const identity = normalizeIdentity({
      uid: user.id,
      email: user.email,
      role: metadata.role || 'USER',
      roles: Array.isArray(metadata.roles) ? metadata.roles : undefined,
      email_verified: Boolean(user.email_confirmed_at),
      name: user.user_metadata?.full_name || user.user_metadata?.name || user.email
    });
    return Object.freeze({
      ...identity,
      tenantId: metadata.tenant_id || null,
      siteId: metadata.site_id || null,
      domainId: metadata.domain_id || metadata.domain || null,
      metadata: { ...identity.metadata, authProvider: 'supabase' }
    });
  } catch {
    return null;
  }
}

export async function authenticateBearer(token) {
  if (!token) return null;

  // Service authentication is intentionally separate from human user identity.
  const serviceToken = process.env.AGENTOS_SERVICE_TOKEN || '';
  if (serviceToken && safeEqual(token, serviceToken)) {
    return Object.freeze({
      id: 'agentos-service',
      provider: 'service',
      email: null,
      name: 'AgentOS service',
      roles: ['SERVICE'],
      permissions: ['*'],
      authenticatedAt: new Date().toISOString(),
      metadata: { service: true }
    });
  }

  return authenticateSupabaseBearer(token);
}

export function hasPermission(identity, permission) {
  if (!identity || typeof permission !== 'string') return false;
  return identity.permissions.includes('*') || identity.permissions.includes(permission);
}

export function ownsResource(identity, resourceUid) {
  if (!identity || !resourceUid) return false;
  return identity.roles.includes('ADMIN') || identity.id === String(resourceUid);
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.user, permission)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

export function requireOwner(paramName = 'uid') {
  return (req, res, next) => {
    if (!ownsResource(req.user, req.params[paramName] || req.body?.[paramName])) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

export { ROLE_PERMISSIONS, normalizeIdentity };
