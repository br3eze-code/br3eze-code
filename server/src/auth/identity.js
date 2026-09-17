/**
 * Canonical, domain-neutral authentication and authorization boundary.
 *
 * User authentication: Firebase ID tokens.
 * Service authentication: AGENTOS_SERVICE_TOKEN.
 * Provider-specific identity remains behind this adapter boundary.
 */
import crypto from 'crypto';
import { admin } from '../config/firebase.js';

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

export async function authenticateBearer(token) {
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

  if (!admin) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return normalizeIdentity(decoded, 'firebase');
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
