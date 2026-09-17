import PaymentGateway from '../../../src/payments/payment-gateway.js';

describe('PaymentGateway compatibility facade', () => {
  test('contains no provider implementation and delegates to the canonical platform', () => {
    const gateway = new PaymentGateway({ disabledPaymentProviders: ['paynow', 'pesapay', 'finivex', 'smilepay', 'zimswitch_online'] });
    expect(gateway.platform).toBeDefined();
    expect(gateway.providers).toBe(gateway.platform.registry.adapters);
    expect(gateway.getAvailableMethods()).toEqual([]);
  });

  test('rejects unavailable providers through the canonical registry', async () => {
    const gateway = new PaymentGateway({ disabledPaymentProviders: ['paynow', 'pesapay', 'finivex', 'smilepay', 'zimswitch_online'] });
    await expect(gateway.createPayment('paynow', { reference: 'compat-test', amount: 1, currency: 'USD' }))
      .rejects.toThrow("Payment provider 'paynow' is not registered");
  });
});
