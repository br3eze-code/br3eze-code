/** Domain-neutral normalized payment event. */

export const PAYMENT_EVENT_TYPES = Object.freeze([
  'payment.pending',
  'payment.succeeded',
  'payment.failed',
  'payment.cancelled',
  'payment.refunded',
  'payment.reversed',
  'payment.settled',
]);

export function createPaymentEvent(input = {}) {
  const type = String(input.type || '').trim().toLowerCase();
  if (!PAYMENT_EVENT_TYPES.includes(type)) throw new TypeError(`Unsupported payment event type: ${type || 'missing'}`);
  if (!input.provider) throw new TypeError('Payment event provider is required');
  if (!input.transactionId) throw new TypeError('Payment event transactionId is required');
  if (!input.reference) throw new TypeError('Payment event reference is required');

  return Object.freeze({
    eventId: String(input.eventId || `${input.provider}:${input.transactionId}:${type}`),
    type,
    provider: String(input.provider),
    transactionId: String(input.transactionId),
    reference: String(input.reference),
    idempotencyKey: input.idempotencyKey ? String(input.idempotencyKey) : null,
    amount: input.amount ?? null,
    currency: input.currency ? String(input.currency).toUpperCase() : null,
    orderId: input.orderId ? String(input.orderId) : null,
    invoiceId: input.invoiceId ? String(input.invoiceId) : null,
    tenantId: input.tenantId ? String(input.tenantId) : null,
    occurredAt: input.occurredAt || new Date().toISOString(),
    metadata: Object.freeze({ ...(input.metadata || {}) }),
  });
}
