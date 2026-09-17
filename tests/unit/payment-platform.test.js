import { webhookIdempotencyKey } from '../../src/payments/payment-platform.js';

describe('payment webhook idempotency keys', () => {
  test('prefers verified provider event id', () => {
    expect(webhookIdempotencyKey({ provider: 'PayNow', eventId: 'evt-123', transactionId: 'tx-1', type: 'payment.succeeded' }))
      .toBe('webhook:paynow:event:evt-123');
  });

  test('falls back to provider transaction and event type', () => {
    expect(webhookIdempotencyKey({ provider: 'PayNow', transactionId: 'tx-1', type: 'payment.succeeded' }))
      .toBe('webhook:paynow:transaction:tx-1:payment.succeeded');
  });
});
