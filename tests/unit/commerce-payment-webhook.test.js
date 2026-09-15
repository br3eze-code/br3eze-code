import { describe, expect, jest, test } from '@jest/globals';
import { createCommerceWebhookHandler } from '../../src/domains/commerce/payment-webhook.js';

function makeResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

function makeDb() {
  const updates = [];
  const transaction = {
    ref: { path: 'transactions/tx-doc' },
    data: () => ({
      orderId: 'order-1', invoiceId: 'invoice-1', paymentMethod: 'stripe',
      providerTransactionId: 'pi_123', amount: 25, currency: 'USD', status: 'pending_payment',
    }),
  };
  const fs = {
    collection(name) {
      return {
        where() { return this; },
        limit() { return this; },
        doc(id) { return { id, path: `${name}/${id}` }; },
      };
    },
    async runTransaction(callback) {
      return callback({
        async get(target) {
          if (target?.path === 'orders/order-1') return { exists: true };
          if (target?.path === 'invoices/invoice-1') return { exists: true };
          return { empty: false, size: 1, docs: [transaction] };
        },
        update(ref, patch) { updates.push({ path: ref.path, patch }); },
      });
    },
  };
  return { db: { db: fs }, updates };
}

describe('commerce payment webhook boundary', () => {
  test('passes the route provider into verified-event reconciliation', async () => {
    const gateway = {
      handleWebhook: jest.fn().mockResolvedValue({
        type: 'payment_success',
        transactionId: 'pi_123',
        amount: 25,
        currency: 'USD',
      }),
    };
    const database = makeDb();
    const handler = createCommerceWebhookHandler(gateway, { db: database });
    const req = {
      params: { provider: 'Stripe' },
      body: { signed: 'payload' },
      headers: { 'stripe-signature': 'signature' },
    };
    const res = makeResponse();

    await handler(req, res);

    expect(gateway.handleWebhook).toHaveBeenCalledWith('stripe', req.body, req.headers);
    expect(database.updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'transactions/tx-doc', patch: expect.objectContaining({ status: 'paid' }) }),
      expect.objectContaining({ path: 'orders/order-1', patch: expect.objectContaining({ status: 'paid', paymentProvider: 'stripe' }) }),
      expect.objectContaining({ path: 'invoices/invoice-1', patch: expect.objectContaining({ status: 'paid' }) }),
    ]));
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
