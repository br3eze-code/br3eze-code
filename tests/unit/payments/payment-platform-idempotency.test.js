import { createPaymentPlatform } from '../../../src/payments/payment-platform.js';
import { PaymentProviderAdapter } from '../../../src/payments/provider-adapter.js';

describe('PaymentPlatform idempotency', () => {
  test('replays a completed result without calling the provider twice', async () => {
    const platform = createPaymentPlatform({ merchantCountry: 'ZW' });
    const provider = new PaymentProviderAdapter({ id: 'test', capabilities: { createPayment: true } });
    let calls = 0;
    provider.createPayment = async () => ({ success: true, status: 'succeeded', transactionId: `tx-${++calls}` });
    platform.registry.register(provider);

    const first = await platform.createPayment('test', { reference: 'same-reference', amount: 1, currency: 'USD' });
    const second = await platform.createPayment('test', { reference: 'same-reference', amount: 1, currency: 'USD' });

    expect(first).toEqual(second);
    expect(calls).toBe(1);
  });
});
