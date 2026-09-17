import { PaymentProviderAdapter } from '../../../src/payments/provider-adapter.js';
import PaymentProviderRegistry from '../../../src/payments/provider-registry.js';
import { assertProviderAllowed, isProviderAllowed } from '../../../src/payments/payment-provider-policy.js';

describe('domain-neutral payment provider platform', () => {
  test('blocks Stripe for Zimbabwe merchants', () => {
    expect(isProviderAllowed('stripe', 'ZW')).toBe(false);
    expect(() => assertProviderAllowed('stripe', 'ZW')).toThrow();
  });

  test('keeps Paynow eligible for Zimbabwe merchants', () => {
    expect(isProviderAllowed('paynow', 'ZW')).toBe(true);
    expect(() => assertProviderAllowed('paynow', 'ZW')).not.toThrow();
  });

  test('registry exposes capabilities without domain concepts', () => {
    const adapter = new PaymentProviderAdapter({
      id: 'example',
      capabilities: { createPayment: true, refunds: false },
    });
    const registry = new PaymentProviderRegistry({ merchantCountry: 'ZW', adapters: [adapter] });
    expect(registry.get('example').supports('createPayment')).toBe(true);
    expect(registry.get('example').supports('refunds')).toBe(false);
  });
});
