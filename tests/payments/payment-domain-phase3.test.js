import { createPaymentEvent } from '../../src/payments/payment-event.js';
import { createLedgerEntry } from '../../src/payments/ledger.js';
import { createSettlement } from '../../src/payments/settlement.js';
import { reconcilePayment } from '../../src/payments/reconciliation.js';

describe('payment domain phase 3', () => {
  test('creates immutable normalized payment event', () => {
    const event = createPaymentEvent({ type: 'payment.succeeded', provider: 'example', transactionId: 'tx-1', reference: 'ref-1', amount: 5, currency: 'usd' });
    expect(event.currency).toBe('USD');
    expect(Object.isFrozen(event)).toBe(true);
  });

  test('rejects incomplete financial events', () => {
    expect(() => createPaymentEvent({ type: 'payment.succeeded', provider: 'example' })).toThrow();
  });

  test('creates positive immutable ledger entries', () => {
    const entry = createLedgerEntry({ transactionId: 'tx-1', direction: 'credit', amount: 5, currency: 'usd' });
    expect(entry.amount).toBe(5);
    expect(Object.isFrozen(entry)).toBe(true);
  });

  test('creates settlement lifecycle records', () => {
    expect(createSettlement({ transactionId: 'tx-1', status: 'released', amount: 5 }).status).toBe('released');
    expect(() => createSettlement({ transactionId: 'tx-1', status: 'unknown' })).toThrow();
  });

  test('reconciles matching financial records and exposes discrepancies', () => {
    const result = reconcilePayment({ transactionId: 'tx-1', reference: 'ref-1', amount: 5, currency: 'USD', status: 'succeeded' }, { provider: 'example', transactionId: 'tx-1', reference: 'ref-1', amount: 5, currency: 'usd', status: 'completed' });
    expect(result.matched).toBe(true);
    expect(result.discrepancies).toEqual([]);
  });
});
