/**
 * Server identity boundary.
 *
 * Human identities are issued by Supabase Auth. Google, GitHub, Microsoft,
 * Apple and Facebook are federated there. This module adds AgentOS permission
 * mapping and service-to-service authentication; it does not verify tokens
 * independently or own an OAuth flow.
 */
import crypto from 'crypto';
import { verifySupabaseAccessToken } from '../adapters/auth/supabase.js';

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
    ? decoded.roles.map(String).map((role) => role.toUpperCase())
    : [String(decoded.role || 'USER').toUpperCase()];
  const uniqueRoles = [...new Set(roles)];
  const permissions = [...new Set(uniqueRoles.flatMap((role) => ROLE_PERMISSIONS[role] || []))];

  return Object.freeze({
    id: decoded.uid || decoded.sub || decoded.id || null,
    provider,
    email: decoded.email || null,
    name: decoded.name || decoded.email || null,
    role: uniqueRoles[0] || 'USER',
    roles: uniqueRoles,
    permissions,
    tenantId: decoded.tenantId || null,
    siteId: decoded.siteId || null,
    domainId: decoded.domainId || null,
    authenticatedAt: new Date().toISOString(),
    metadata: { emailVerified: Boolean(decoded.emailVerified), authProvider: provider }
  });
}

async function authenticateSupabaseBearer(token) {
  const user = await verifySupabaseAccessToken(token);
  return user ? normalizeIdentity(user, 'supabase') : null;
}

export async function authenticateBearer(token) {
  if (!token) return null;

  // Machine authentication is distinct from every human identity provider.
  const serviceToken = process.env.AGENTOS_SERVICE_TOKEN || '';
  if (serviceToken && safeEqual(token, serviceToken)) {
    return Object.freeze({
      id: 'agentos-service',
      provider: 'service',
      email: null,
      name: 'AgentOS service',
      role: 'SERVICE',
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
    return next();
  };
}

export function requireOwner(paramName = 'uid') {
  return (req, res, next) => {
    if (!ownsResource(req.user, req.params[paramName] || req.body?.[paramName])) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

export { ROLE_PERMISSIONS, normalizeIdentity };
