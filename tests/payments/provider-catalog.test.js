import { PAYMENT_PROVIDER_CATALOG, listZimbabweProviders } from '../../src/payments/provider-catalog.js';
import { isProviderAllowed } from '../../src/payments/payment-provider-policy.js';

describe('Zimbabwe payment provider catalog', () => {
  test('includes the major currently discoverable Zimbabwe gateways and rails', () => {
    const ids = new Set(listZimbabweProviders().map((provider) => provider.id));
    for (const id of [
      'paynow', 'ecocash', 'onemoney', 'innbucks', 'omari', 'telecash',
      'zimswitch', 'zimswitch_online', 'pesapay', 'smilepay', 'contipay',
      'linkwa', 'finivex', 'payonify', 'zuripay'
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  test('does not treat discontinued ZuriPay as an active implementation', () => {
    expect(PAYMENT_PROVIDER_CATALOG.zuripay.adapterStatus).toBe('discontinued');
    expect(isProviderAllowed('zuripay', 'ZW')).toBe(false);
  });

  test('keeps Stripe blocked for Zimbabwe merchants', () => {
    expect(isProviderAllowed('stripe', 'ZW')).toBe(false);
    expect(isProviderAllowed('stripe', 'ZA')).toBe(true);
  });
});
