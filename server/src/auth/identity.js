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

function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function signUserToken(payload, secret) {
  const header = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = encodeBase64Url(JSON.stringify(payload));
  const unsigned = `${header}.${body}`;
  const signature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function verifyUserToken(token, secret) {
  if (typeof token !== 'string' || typeof secret !== 'string' || secret.length < 16) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signature] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${headerPart}.${payloadPart}`).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== 'HS256' || payload.iss !== 'agentos' || payload.aud !== 'agentos-api' ||
        !Number.isFinite(payload.exp) || payload.exp <= now || !payload.sub) return null;
    return payload;
  } catch {
    return null;
  }
}

export function issueUserToken({ uid, username, role }, secret) {
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new TypeError('A signing secret of at least 16 characters is required');
  }
  const subject = uid || username;
  if (!subject) throw new TypeError('A user identifier is required');
  const now = Math.floor(Date.now() / 1000);
  return signUserToken({
    sub: String(subject),
    role: String(role || 'USER').toUpperCase(),
    iss: 'agentos',
    aud: 'agentos-api',
    iat: now,
    exp: now + 3600
  }, secret);
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
    const decoded = verifyUserToken(token, userTokenSecret);
    if (decoded) return normalizeIdentity(decoded, 'local');
  }

  if (!admin) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(token, true);
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
