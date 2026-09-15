import { describe, expect, jest, test } from '@jest/globals';
import { createCommerceWebhookHandler } from '../../src/domains/commerce/payment-webhook.js';

const reconciliationModule = await import('../../src/domains/commerce/payment-reconciliation.js');

function makeResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe('commerce payment webhook boundary', () => {
  test('passes the route provider into reconciliation after gateway verification', async () => {
    const gateway = {
      handleWebhook: jest.fn().mockResolvedValue({
        type: 'payment_success',
        transactionId: 'pi_123',
        amount: 25,
        currency: 'USD',
      }),
    };
    const db = {
      db: {
        collection: jest.fn(),
        runTransaction: jest.fn(),
      },
    };

    const reconcileSpy = jest.spyOn(reconciliationModule, 'reconcileCommercePayment');
    reconcileSpy.mockResolvedValue({ reconciled: true, orderId: 'order-1' });

    const handler = createCommerceWebhookHandler(gateway, { db });
    const req = {
      params: { provider: 'Stripe' },
      body: { signed: 'payload' },
      headers: { 'stripe-signature': 'signature' },
    };
    const res = makeResponse();

    await handler(req, res);

    expect(gateway.handleWebhook).toHaveBeenCalledWith('stripe', req.body, req.headers);
    expect(reconcileSpy).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'stripe', transactionId: 'pi_123' }),
      { db, scope: {} },
    );
    expect(res.status).toHaveBeenCalledWith(200);
    reconcileSpy.mockRestore();
  });
});
