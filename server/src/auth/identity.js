/**
 * Canonical, domain-neutral authentication and authorization boundary.
 *
 * User authentication: Firebase ID tokens.
 * Service authentication: AGENTOS_SERVICE_TOKEN.
 * Provider-specific identity remains behind this adapter boundary.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { admin } from '../config/firebase.js';
import { verifySupabaseAccessToken } from '../../../src/adapters/auth/supabase.js';

const ROLE_PERMISSIONS = Object.freeze({
  ADMIN: ['*'],
  PARTNER: [
    'inventory.read', 'orders.read', 'orders.create',
    'payments.read', 'vouchers.read'
  ],
  CASHIER: [
    'orders.read', 'orders.create', 'payments.create',
    'vouchers.read', 'vouchers.create'
  ],
  USER: [
    'profile.read', 'profile.update', 'orders.create', 'payments.create'
  ]
});

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function normalizeIdentity(decoded, provider = 'firebase') {
  const roles = Array.isArray(decoded.roles)
    ? decoded.roles.map(String).map(r => r.toUpperCase())
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

export function issueUserToken({ uid, username, role }, secret) {
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new TypeError('A signing secret of at least 16 characters is required');
  }
  const subject = uid || username;
  if (!subject) throw new TypeError('A user identifier is required');
  return jwt.sign(
    { role: String(role || 'USER').toUpperCase() },
    secret,
    { subject: String(subject), issuer: 'agentos', audience: 'agentos-api', expiresIn: '1h' }
  );
}

export async function authenticateBearer(token, { userTokenSecret } = {}) {
  if (!token) return null;

  const serviceToken = process.env.AGENTOS_SERVICE_TOKEN || process.env.GATEWAY_TOKEN || '';
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

  if (userTokenSecret) {
    try {
      const decoded = jwt.verify(token, userTokenSecret, {
        issuer: 'agentos',
        audience: 'agentos-api'
      });
      return normalizeIdentity(decoded, 'local');
    } catch {
      // Continue to the configured external identity providers.
    }
  }

  if (admin) {
    try {
      const decoded = await admin.auth().verifyIdToken(token, true);
      return normalizeIdentity(decoded, 'firebase');
    } catch {
      // A token may belong to the configured Supabase identity provider.
    }
  }

  try {
    const decoded = await verifySupabaseAccessToken(token);
    if (!decoded) return null;
    const identity = normalizeIdentity({
      uid: decoded.uid,
      email: decoded.email,
      role: decoded.role,
      roles: decoded.roles,
      email_verified: decoded.emailVerified
    }, 'supabase');
    return Object.freeze({
      ...identity,
      tenantId: decoded.tenantId || null,
      siteId: decoded.siteId || null,
      metadata: { ...identity.metadata, authProvider: 'supabase', domain: decoded.domain || null }
    });
  } catch {
    return null;
  }
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
    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
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
