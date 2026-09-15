import { describe, expect, test } from '@jest/globals';
import { reconcileCommercePayment } from '../../src/domains/commerce/payment-reconciliation.js';

function makeDb(transactionData = {}) {
  const updates = [];
  const transactionRef = { id: 'tx-doc', path: 'transactions/tx-doc' };
  const orderRef = { id: transactionData.orderId, path: `orders/${transactionData.orderId}` };
  const invoiceRef = { id: transactionData.invoiceId, path: `invoices/${transactionData.invoiceId}` };
  const docs = {
    transaction: { ref: transactionRef, data: () => transactionData },
    order: { exists: true, data: () => ({ status: 'pending_payment' }) },
    invoice: { exists: true, data: () => ({ status: 'unpaid' }) },
  };
  const fs = {
    collection(name) {
      return {
        where() { return this; },
        limit() { return this; },
        doc(id) {
          if (name === 'orders') return { ...orderRef, id };
          if (name === 'invoices') return { ...invoiceRef, id };
          return { ...transactionRef, id };
        },
      };
    },
    async runTransaction(callback) {
      const tx = {
        async get(target) {
          if (target?.path === 'orders/order-1') return docs.order;
          if (target?.path === 'invoices/invoice-1') return docs.invoice;
          return { empty: false, size: 1, docs: [docs.transaction] };
        },
        update(ref, patch) { updates.push({ path: ref.path, patch }); },
      };
      return callback(tx);
    },
  };
  return { db: { db: fs }, updates };
}

describe('commerce payment reconciliation', () => {
  test('settles a verified successful provider event atomically', async () => {
    const database = makeDb({
      orderId: 'order-1',
      invoiceId: 'invoice-1',
      paymentMethod: 'stripe',
      providerTransactionId: 'pi_123',
      amount: 25,
      currency: 'USD',
      status: 'pending_payment',
    });

    const result = await reconcileCommercePayment({
      provider: 'stripe', transactionId: 'pi_123', status: 'succeeded',
      amount: 25, currency: 'USD', eventId: 'evt_1',
    }, database);

    expect(result).toMatchObject({ reconciled: true, orderId: 'order-1', status: 'paid', orderStatus: 'paid' });
    expect(database.updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'transactions/tx-doc', patch: expect.objectContaining({ status: 'paid', providerStatus: 'succeeded' }) }),
      expect.objectContaining({ path: 'orders/order-1', patch: expect.objectContaining({ status: 'paid', paymentTransactionId: 'pi_123' }) }),
      expect.objectContaining({ path: 'invoices/invoice-1', patch: expect.objectContaining({ status: 'paid' }) }),
    ]));
  });

  test('rejects an amount mismatch before writing anything', async () => {
    const database = makeDb({
      orderId: 'order-1', invoiceId: 'invoice-1', paymentMethod: 'stripe',
      providerTransactionId: 'pi_123', amount: 25, currency: 'USD', status: 'pending_payment',
    });

    await expect(reconcileCommercePayment({ provider: 'stripe', transactionId: 'pi_123', status: 'succeeded', amount: 20, currency: 'USD' }, database))
      .rejects.toThrow(/amount/);
    expect(database.updates).toHaveLength(0);
  });

  test('treats duplicate successful webhook delivery as a replay', async () => {
    const database = makeDb({
      orderId: 'order-1', invoiceId: 'invoice-1', paymentMethod: 'stripe',
      providerTransactionId: 'pi_123', amount: 25, currency: 'USD', status: 'paid',
    });

    const result = await reconcileCommercePayment({ provider: 'stripe', transactionId: 'pi_123', status: 'succeeded', amount: 25, currency: 'USD' }, database);

    expect(result).toMatchObject({ reconciled: false, replay: true, status: 'paid' });
    expect(database.updates).toHaveLength(0);
  });

  test('does not touch the database for unsupported provider statuses', async () => {
    const result = await reconcileCommercePayment({ provider: 'stripe', transactionId: 'pi_123', status: 'processing' });
    expect(result).toMatchObject({ ignored: true, reason: 'unsupported_status' });
  });
});
