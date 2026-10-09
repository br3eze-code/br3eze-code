import { createPaymentPlatform, webhookIdempotencyKey } from '../../src/payments/payment-platform.js';
import { PaymentProviderAdapter } from '../../src/payments/provider-adapter.js';

class TestProvider extends PaymentProviderAdapter {
  constructor() {
    super({ id: 'test', capabilities: { createPayment: true, verifyPayment: true, refunds: true, webhooks: true, reconciliation: true } });
    this.createCalls = 0;
    this.refundCalls = 0;
  }
  async createPayment(data) {
    this.createCalls += 1;
    return { success: true, status: 'succeeded', transactionId: 'tx-1', reference: data.reference, amount: data.amount, currency: data.currency || 'USD' };
  }
  async verifyPayment(data) { return { success: true, status: 'succeeded', transactionId: data }; }
  async refundPayment(transactionId, data) {
    this.refundCalls += 1;
    return { success: true, status: 'refunded', transactionId, reference: transactionId, amount: data.amount, currency: 'USD' };
  }
  async verifyWebhook() { return true; }
  async processWebhook() { return { status: 'succeeded', transactionId: 'tx-webhook', reference: 'ref-webhook', eventId: 'evt-1', amount: 5, currency: 'USD' }; }
  async reconcile(data) { return data; }
}

function makePersistence() {
  const rows = new Map();
  const transactions = new Map();
  return {
    rows,
    async claimIdempotency(key, operation, requestHash) {
      if (rows.has(key)) return { claimed: false, record: rows.get(key) };
      const record = { idempotency_key: key, operation, request_hash: requestHash, status: 'processing' };
      rows.set(key, record);
      return { claimed: true, record };
    },
    async completeIdempotency(key, response) {
      const record = rows.get(key);
      record.status = 'completed';
      record.response = response;
      return record;
    },
    async releaseIdempotency(key) { rows.delete(key); },
    async upsertTransaction(transaction) { transactions.set(transaction.transactionId, transaction); return transaction; },
    async insertEvent(event) { return event; },
  };
}

describe('payment platform idempotency and refund safety', () => {
  test('prefers verified provider event id', () => {
    expect(webhookIdempotencyKey({ provider: 'PayNow', eventId: 'evt-123', transactionId: 'tx-1', type: 'payment.succeeded' }))
      .toBe('webhook:paynow:event:evt-123');
  });

  test('falls back to provider transaction and event type', () => {
    expect(webhookIdempotencyKey({ provider: 'PayNow', transactionId: 'tx-1', type: 'payment.succeeded' }))
      .toBe('webhook:paynow:transaction:tx-1:payment.succeeded');
  });

  test('does not call provider twice for the same persistent payment key', async () => {
    const provider = new TestProvider();
    const persistence = makePersistence();
    const platform = createPaymentPlatform({
      persistence,
      idempotencyStore: { get: () => null, set: (key, value) => value },
      merchantCountry: 'ZW',
    });
    platform.registry.register(provider);
    const first = await platform.createPayment('test', { reference: 'order-1', amount: 5, currency: 'USD' });
    const second = await platform.createPayment('test', { reference: 'order-1', amount: 5, currency: 'USD' });
    expect(provider.createCalls).toBe(1);
    expect(first.transactionId).toBe('tx-1');
    expect(second.transactionId).toBe('tx-1');
  });

  test('rejects reuse of an idempotency key with a different request', async () => {
    const provider = new TestProvider();
    const persistence = makePersistence();
    const platform = createPaymentPlatform({ persistence, merchantCountry: 'ZW' });
    platform.registry.register(provider);
    await platform.createPayment('test', { idempotencyKey: 'same-key', reference: 'order-1', amount: 5 });
    await expect(platform.createPayment('test', { idempotencyKey: 'same-key', reference: 'order-1', amount: 7 }))
      .rejects.toThrow(/different request/);
  });

  test('persists a successful refund and makes repeated refunds idempotent', async () => {
    const provider = new TestProvider();
    const persistence = makePersistence();
    const platform = createPaymentPlatform({ persistence, merchantCountry: 'ZW' });
    platform.registry.register(provider);
    const first = await platform.refund('test', 'tx-1', 5, 'customer request');
    const second = await platform.refund('test', 'tx-1', 5, 'customer request');
    expect(provider.refundCalls).toBe(1);
    expect(first.status).toBe('refunded');
    expect(second.status).toBe('refunded');
    expect(persistence.transactions.get('tx-1').status).toBe('refunded');
  });

  test('rejects non-positive refund amounts', async () => {
    const platform = createPaymentPlatform({ persistence: null, merchantCountry: 'ZW' });
    const provider = new TestProvider();
    platform.registry.register(provider);
    await expect(platform.refund('test', 'tx-1', 0)).rejects.toThrow(/positive/);
  });
});
