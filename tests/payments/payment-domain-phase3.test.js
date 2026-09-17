import { createPaymentEvent } from '../../src/payments/payment-event.js';
import { createLedgerEntry } from '../../src/payments/ledger.js';
import { createSettlement } from '../../src/payments/settlement.js';
import { reconcilePayment } from '../../src/payments/reconciliation.js';

describe('payment domain Phase E contracts', () => {
  test('creates normalized payment events', () => {
    const event = createPaymentEvent({ type: 'payment.succeeded', provider: 'test', transactionId: 'tx-1', reference: 'ref-1', amount: 5, currency: 'usd' });
    expect(event.type).toBe('payment.succeeded'); expect(event.currency).toBe('USD');
  });
  test('validates ledger entries and settlement state', () => {
    expect(createLedgerEntry({ transactionId: 'tx-1', direction: 'credit', amount: 5 }).amount).toBe(5);
    expect(createSettlement({ transactionId: 'tx-1', status: 'released' }).status).toBe('released');
    expect(() => createLedgerEntry({ transactionId: 'tx-1', direction: 'invalid', amount: 5 })).toThrow();
  });
  test('reconciles matching financial records and exposes discrepancies', () => {
    const result = reconcilePayment({ transactionId: 'tx-1', reference: 'ref-1', amount: 5, currency: 'USD', status: 'succeeded' }, { provider: 'example', transactionId: 'tx-1', reference: 'ref-1', amount: 5, currency: 'usd', status: 'completed' });
    expect(result.matched).toBe(true); expect(result.discrepancies).toEqual([]);
  });
});
