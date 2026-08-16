import crypto from 'crypto';

const DEFAULT_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'ZWL', 'ZIG', 'KES', 'UGX', 'NGN']);
const SENSITIVE_KEYS = /token|secret|key|pin|password|authorization|signature|access|refresh/i;

export function normalizePaymentRequest(input = {}, { defaultCurrency = 'USD', allowedCurrencies = DEFAULT_CURRENCIES } = {}) {
  const amount = Number(input.amount ?? (input.amountMinor != null ? Number(input.amountMinor) / 100 : NaN));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment amount must be greater than zero');
  if (amount > 10_000_000) throw new Error('Payment amount exceeds the configured limit');
  const currency = String(input.currency || defaultCurrency).trim().toUpperCase();
  if (!allowedCurrencies.has(currency)) throw new Error(`Unsupported payment currency: ${currency}`);
  const suppliedReference = String(input.reference || input.merchantReference || '').trim();
  const reference = suppliedReference || `payment-${crypto.randomUUID()}`;
  if (reference.length > 160) throw new Error('A valid payment reference is required');
  return {
    ...input,
    amount,
    amountMinor: Math.round(amount * 100),
    currency,
    reference,
    metadata: sanitizeMetadata(input.metadata || {}),
  };
}

export function assertTransactionId(value) {
  const transactionId = String(value || '').trim();
  if (!transactionId || transactionId.length > 240 || /[\r\n]/.test(transactionId)) {
    throw new Error('A valid payment transaction ID is required');
  }
  return transactionId;
}

export function createIdempotencyKey(provider, reference, suffix = '') {
  const raw = `${provider}:${reference}:${suffix}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function safeWebhookBody(payload = {}) {
  return sanitizeMetadata(payload);
}

export function sanitizeMetadata(value, depth = 0) {
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeMetadata(item, depth + 1));
  if (!value || typeof value !== 'object') return typeof value === 'string' && value.length > 1000 ? `${value.slice(0, 1000)}…` : value;
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [
    key,
    SENSITIVE_KEYS.test(key) ? '[redacted]' : sanitizeMetadata(item, depth + 1),
  ]));
}

export function requireWebhookVerification(provider, verified) {
  if (!verified) throw new Error('Invalid webhook signature');
  return true;
}

export function normalizeProviderStatus(result = {}) {
  const status = String(result.status || (result.success ? 'succeeded' : 'unknown')).toLowerCase();
  return {
    ...result,
    status,
    success: result.success === true || ['succeeded', 'successful', 'completed', 'paid'].includes(status),
  };
}

export const PAYMENT_STATUSES = Object.freeze({
  PENDING: 'pending',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  REVERSED: 'reversed',
  REFUNDED: 'refunded',
});

export default {
  normalizePaymentRequest,
  assertTransactionId,
  createIdempotencyKey,
  safeWebhookBody,
  sanitizeMetadata,
  requireWebhookVerification,
  normalizeProviderStatus,
  PAYMENT_STATUSES,
};

export { DEFAULT_CURRENCIES };

/* eslint no-unused-vars: 0 */
// The default export is retained for CommonJS-compatible consumers migrating to ESM.
