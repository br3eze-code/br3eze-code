import { describe, expect, test } from '@jest/globals';
import { assertCheckoutPaymentMethod, isExternalPaymentMethod } from '../../src/domains/commerce/shop.js';

describe('commerce payment settlement boundary', () => {
  test('recognises supported external payment methods', () => {
    for (const method of ['card', 'ecocash', 'netone', 'paynow', 'apple_pay', 'google_pay', 'pesapay']) {
      expect(isExternalPaymentMethod(method)).toBe(true);
      expect(assertCheckoutPaymentMethod(method)).toBe(method);
    }
  });

  test('rejects unknown payment methods instead of silently treating them as paid', () => {
    expect(() => assertCheckoutPaymentMethod('made_up_gateway')).toThrow(/Unsupported payment method/);
  });

  test('normalises payment method names', () => {
    expect(assertCheckoutPaymentMethod(' CARD ')).toBe('card');
    expect(assertCheckoutPaymentMethod()).toBe('cod');
  });
});
