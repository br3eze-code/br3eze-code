import { createPaymentPlatform } from '../../../src/payments/payment-platform.js';
import { PaymentProviderAdapter } from '../../../src/payments/provider-adapter.js';

describe('PaymentPlatform idempotency', () => {
  test('replays a completed result without calling the provider twice', async () => {
    const provider = new PaymentProviderAdapter({ id: 'test', capabilities: { createPayment: true } });
    let calls = 0;
    provider.createPayment = async () => { calls += 1; return { transactionId: 'tx-1', status: 'succeeded' }; };
    const platform = createPaymentPlatform({ adapters: [provider] });
    const first = await platform.createPayment('test', { amount: 5, reference: 'ref-1' });
    const second = await platform.createPayment('test', { amount: 5, reference: 'ref-1' });
    expect(second).toEqual(first); expect(calls).toBe(1);
    platform.close?.();
  });
});
