import {
  applyPaymentProviderPolicy,
  assertProviderAllowed,
  isProviderAllowed,
} from '../../../src/payments/payment-provider-policy.js';

describe('payment provider country policy', () => {
  test('blocks Stripe for Zimbabwe merchants', () => {
    expect(isProviderAllowed('stripe', 'ZW')).toBe(false);
    expect(() => assertProviderAllowed('stripe', 'ZW')).toThrow(
      "Payment provider 'stripe' is not enabled for merchant country 'ZW'"
    );
  });

  test('allows Zimbabwe-native providers for Zimbabwe merchants', () => {
    for (const provider of ['paynow', 'ecocash', 'netone', 'pesapay', 'smilepay', 'contipay', 'zuripay']) {
      expect(isProviderAllowed(provider, 'ZW')).toBe(true);
    }
  });

  test('preserves Stripe eligibility outside the explicit Zimbabwe block', () => {
    expect(isProviderAllowed('stripe', 'US')).toBe(true);
  });

  test('factory policy removes blocked Stripe credentials instead of silently exposing Stripe', () => {
    const config = applyPaymentProviderPolicy({
      merchantCountry: 'ZW',
      stripeSecretKey: 'sk_test_do_not_use',
      stripeWebhookSecret: 'whsec_test_do_not_use',
      stripePublishableKey: 'pk_test_do_not_use',
      paynowIntegrationId: 'PN123',
      paynowIntegrationKey: 'PNKEY',
    });

    expect(config.merchantCountry).toBe('ZW');
    expect(config.disabledPaymentProviders).toContain('stripe');
    expect(config).not.toHaveProperty('stripeSecretKey');
    expect(config).not.toHaveProperty('stripeWebhookSecret');
    expect(config).not.toHaveProperty('stripePublishableKey');
    expect(config.paynowIntegrationId).toBe('PN123');
  });
});
