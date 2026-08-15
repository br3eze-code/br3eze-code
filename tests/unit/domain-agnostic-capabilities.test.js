import { jest } from '@jest/globals';
import PaymentService from '../../src/payments/payment-service.js';

describe('domain-agnostic payment capabilities', () => {
  test('creates an idempotent normalized payment through the existing gateway', async () => {
    const gateway = {
      createPayment: jest.fn().mockResolvedValue({ transactionId: 'provider-1', status: 'pending' }),
    };
    const service = new PaymentService(gateway);
    const payment = await service.createPayment({
      provider: 'stripe',
      paymentId: 'payment-1',
      amountMinor: 1250,
      currency: 'USD',
      customer: { email: 'user@example.com' },
      metadata: { source: 'ask-engine' },
    });

    expect(gateway.createPayment).toHaveBeenCalledWith('stripe', expect.objectContaining({
      amount: 12.5,
      amountMinor: 1250,
      reference: 'payment-1',
    }));
    expect(payment).toMatchObject({
      id: 'payment-1',
      provider: 'stripe',
      amountMinor: 1250,
      providerReference: 'provider-1',
      status: 'pending',
    });
  });
});
