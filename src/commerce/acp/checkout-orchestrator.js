import crypto from 'node:crypto';
import { createPaymentIdempotencyStore } from '../../payments/idempotency-store.js';
import { checkout } from '../../core/shop.js';
import {
  fingerprintRequest,
  validateIdempotencyKey,
} from './checkout-session.js';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function namespaceKey({ idempotencyKey, merchantId, buyerId = null }) {
  const raw = `${merchantId || 'merchant'}:${buyerId || 'guest'}:${idempotencyKey}`;
  return `acp:${crypto.createHash('sha256').update(raw).digest('hex')}`;
}

function conflictError() {
  const error = new Error('Idempotency key was already used with a different request.');
  error.status = 409;
  return error;
}

function pendingError() {
  const error = new Error('The checkout request is already being processed. Retry with the same idempotency key.');
  error.status = 409;
  return error;
}

/**
 * Request-scoped commerce mutation guard.
 *
 * This prevents duplicate sequential/concurrent calls at the orchestration
 * boundary and replays the completed result after a retry. The underlying shop
 * checkout remains authoritative for product price, stock and order creation.
 *
 * The store is deliberately injectable. The default is the existing durable
 * SQLite/file idempotency store; a distributed Firestore implementation should
 * replace it before multi-instance ACP production traffic is enabled.
 */
export async function executeCheckout({
  idempotencyKey,
  merchantId,
  buyerId = null,
  platform,
  channelId,
  address = {},
  payMethod = 'cod',
  scope = {},
  idempotencyStore = null,
  idempotencyOptions = {},
} = {}) {
  const key = validateIdempotencyKey(idempotencyKey);
  if (!merchantId) throw new Error('merchantId is required.');
  if (!platform || !channelId) throw new Error('platform and channelId are required.');

  const store = idempotencyStore || createPaymentIdempotencyStore({
    ttlMs: DEFAULT_TTL_MS,
    ...idempotencyOptions,
  });
  const storageKey = namespaceKey({ idempotencyKey: key, merchantId, buyerId });
  const requestFingerprint = fingerprintRequest({
    merchantId,
    buyerId,
    platform,
    channelId: String(channelId),
    address,
    payMethod,
    scope,
  });

  const existing = store.get(storageKey);
  if (existing && existing.requestFingerprint !== requestFingerprint) throw conflictError();
  if (existing?.result) return { ...existing.result, replayed: true };
  if (existing?.pending) throw pendingError();

  const metadata = {
    requestFingerprint,
    merchantId,
    buyerId,
    platform,
    channelId: String(channelId),
  };
  if (!store.reserve(storageKey, metadata, DEFAULT_TTL_MS)) {
    const concurrent = store.get(storageKey);
    if (concurrent?.requestFingerprint && concurrent.requestFingerprint !== requestFingerprint) throw conflictError();
    if (concurrent?.result) return { ...concurrent.result, replayed: true };
    throw pendingError();
  }

  try {
    const result = await checkout(platform, channelId, {
      uid: buyerId,
      address,
      payMethod,
      scope,
    });
    const persisted = { ...result, requestFingerprint };
    store.set(storageKey, persisted, DEFAULT_TTL_MS);
    return persisted;
  } catch (error) {
    if (typeof store.release === 'function') store.release(storageKey);
    throw error;
  }
}

export { namespaceKey };
