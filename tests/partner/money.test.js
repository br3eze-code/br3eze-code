import { describe, expect, test } from '@jest/globals';
import { splitCommission, sumMoney } from '../../services/partner/money.mjs';

describe('partner money primitives', () => {
  test('sums integer minor units without floating point arithmetic', () => {
    expect(sumMoney([
      { amountMinor: 150, currency: 'KES' },
      { amountMinor: 350, currency: 'KES' },
    ], 'KES')).toBe(500);
  });

  test('rejects mixed currencies', () => {
    expect(() => sumMoney([
      { amountMinor: 100, currency: 'KES' },
      { amountMinor: 100, currency: 'USD' },
    ], 'KES')).toThrow(/Currency mismatch/);
  });

  test('splits settlement using basis points', () => {
    expect(splitCommission(1000, 8500)).toEqual({
      partnerMinor: 850,
      platformMinor: 150,
    });
  });
});
