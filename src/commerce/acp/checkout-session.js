import crypto from 'node:crypto';

const MAX_KEY_LENGTH = 128;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function validateIdempotencyKey(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_KEY_LENGTH || !KEY_PATTERN.test(value)) {
    throw new Error('A valid idempotency key is required.');
  }
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function fingerprintRequest(payload = {}) {
  const normalized = canonicalize(payload);
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function createCheckoutSession({ idempotencyKey, merchantId, buyerId = null, currency = null, items = [], totals = {}, checkoutUrl = null } = {}) {
  const key = validateIdempotencyKey(idempotencyKey);
  if (!merchantId) throw new Error('merchantId is required.');
  if (!Array.isArray(items)) throw new Error('items must be an array.');

  const now = new Date().toISOString();
  return {
    id: `cs_${crypto.randomUUID()}`,
    idempotencyKey: key,
    requestFingerprint: fingerprintRequest({ merchantId, buyerId, currency, items, totals }),
    merchantId,
    buyerId,
    currency,
    items,
    totals,
    checkoutUrl,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
}

export const CHECKOUT_SESSION_STATUSES = Object.freeze([
  'pending',
  'requires_payment',
  'paid',
  'processing',
  'fulfilled',
  'cancelled',
  'refunded',
]);

export function assertCheckoutTransition(from, to) {
  if (!CHECKOUT_SESSION_STATUSES.includes(to)) throw new Error(`Unsupported checkout status: ${to}`);
  const allowed = {
    pending: ['requires_payment', 'paid', 'cancelled'],
    requires_payment: ['paid', 'cancelled'],
    paid: ['processing', 'cancelled', 'refunded'],
    processing: ['fulfilled', 'cancelled', 'refunded'],
    fulfilled: ['refunded'],
    cancelled: [],
    refunded: [],
  };
  if (from && !(allowed[from] || []).includes(to)) {
    throw new Error(`Invalid checkout transition: ${from} -> ${to}`);
  }
  return true;
}

export function idempotencyConflict(existing, incomingFingerprint) {
  return Boolean(existing && existing.requestFingerprint !== incomingFingerprint);
}

export function idempotencyResult(existing, incomingFingerprint) {
  if (!existing) return { state: 'new' };
  if (idempotencyConflict(existing, incomingFingerprint)) {
    return { state: 'conflict', error: 'Idempotency key was already used with a different request.' };
  }
  return { state: 'replay', session: existing };
}
