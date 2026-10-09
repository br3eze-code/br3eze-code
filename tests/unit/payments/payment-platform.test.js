import { createPaymentPlatform, createPaymentProviderRegistry } from '../../../src/payments/payment-platform.js';

describe('PaymentPlatform', () => {
  test('registers only configured providers and exposes normalized capabilities', () => {
    const registry = createPaymentProviderRegistry({
      merchantCountry: 'ZW',
      paynowIntegrationId: 'id',
      paynowIntegrationKey: 'key',
    });

    const providers = registry.list();
    expect(providers.map(({ id }) => id)).toContain('paynow');
    expect(registry.capabilities('paynow')).toEqual(expect.objectContaining({
      createPayment: true,
      verifyPayment: true,
    }));
  });

  test('fails closed for providers that are not configured', () => {
    const platform = createPaymentPlatform({ merchantCountry: 'ZW' });
    expect(platform.providers()).toEqual([]);
    expect(() => platform.provider('stripe')).toThrow();
  });

  test('does not make Stripe available for a Zimbabwe merchant', () => {
    const registry = createPaymentProviderRegistry({
      merchantCountry: 'ZW',
      stripeSecretKey: 'sk_test_should_not_be_used',
    });
    expect(registry.get('stripe')).toBeNull();
  });
});
