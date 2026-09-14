import crypto from 'node:crypto';
import { createPaymentIdempotencyStore } from '../../payments/idempotency-store.js';
import { checkout as defaultCheckout } from '../../domains/commerce/shop.js';
import { fingerprintRequest, validateIdempotencyKey } from './checkout-session.js';

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
  checkoutFn = defaultCheckout,
} = {}) {
  const key = validateIdempotencyKey(idempotencyKey);
  if (!merchantId) throw new Error('merchantId is required.');
  if (!platform || !channelId) throw new Error('platform and channelId are required.');
  if (typeof checkoutFn !== 'function') throw new TypeError('checkoutFn must be a function.');

  const store = idempotencyStore || createPaymentIdempotencyStore({ ttlMs: DEFAULT_TTL_MS, ...idempotencyOptions });
  const storageKey = namespaceKey({ idempotencyKey: key, merchantId, buyerId });
  const requestFingerprint = fingerprintRequest({ merchantId, buyerId, platform, channelId: String(channelId), address, payMethod, scope });

  const existing = store.get(storageKey);
  const existingFingerprint = existing?.requestFingerprint || existing?.metadata?.requestFingerprint;
  if (existingFingerprint && existingFingerprint !== requestFingerprint) throw conflictError();
  if (existing && !existing?.pending && existing?.orderId) return { ...existing, replayed: true };
  if (existing?.pending) throw pendingError();

  const metadata = { requestFingerprint, merchantId, buyerId, platform, channelId: String(channelId) };
  if (!store.reserve(storageKey, metadata, DEFAULT_TTL_MS)) {
    const concurrent = store.get(storageKey);
    const concurrentFingerprint = concurrent?.requestFingerprint || concurrent?.metadata?.requestFingerprint;
    if (concurrentFingerprint && concurrentFingerprint !== requestFingerprint) throw conflictError();
    if (concurrent && !concurrent?.pending && concurrent?.orderId) return { ...concurrent, replayed: true };
    throw pendingError();
  }

  try {
    const result = await checkoutFn(platform, channelId, { uid: buyerId, address, payMethod, scope });
    const persisted = { ...result, requestFingerprint };
    store.set(storageKey, persisted, DEFAULT_TTL_MS);
    return persisted;
  } catch (error) {
    if (typeof store.release === 'function') store.release(storageKey);
    throw error;
  }
}

export { namespaceKey };
