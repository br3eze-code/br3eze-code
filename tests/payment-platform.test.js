import PaymentProviderRegistry from '../src/payments/provider-registry.js';
import { createPaymentPlatform, createPaymentProviderRegistry } from '../src/payments/payment-platform.js';
import { providersForRail } from '../src/payments/provider-rails.js';

describe('domain-agnostic payment platform', () => {
  test('keeps rails separate from gateways', () => {
    expect(providersForRail('mobile_money')).toEqual(expect.arrayContaining(['ecocash', 'onemoney', 'telecash']));
    expect(providersForRail('card')).toEqual(expect.arrayContaining(['visa', 'mastercard', 'zimswitch']));
  });

  test('registry exposes capabilities without leaking provider implementation', () => {
    const registry = new PaymentProviderRegistry({ merchantCountry: 'ZW' });
    const adapter = { id: 'test-provider', capabilities: { createPayment: true }, supports: (op) => op === 'createPayment' };
    registry.register(adapter);
    expect(registry.capabilities('test-provider').createPayment).toBe(true);
    expect(registry.list({ operation: 'createPayment' })).toHaveLength(1);
  });

  test('factory does not invent providers without merchant credentials', () => {
    const registry = createPaymentProviderRegistry({ merchantCountry: 'ZW', disabledPaymentProviders: [] });
    expect(registry.get('paynow')).toBeNull();
    expect(registry.get('smilepay')).toBeNull();
  });

  test('platform exposes one normalized provider boundary', () => {
    const platform = createPaymentPlatform({ merchantCountry: 'ZW' });
    expect(platform).toHaveProperty('registry');
    expect(platform).toHaveProperty('providers');
    expect(platform).toHaveProperty('capabilities');
    expect(platform).toHaveProperty('createPayment');
  });
});
