'use strict';

const { createWebhookHandler, setupWebhookRoutes } = require('../../../src/payments/webhook-handler');

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function makeGateway({ handleWebhookResult = true, processWebhookResult = { type: 'payment_success' } } = {}) {
  const provider = { processWebhook: jest.fn().mockResolvedValue(processWebhookResult) };
  return {
    handleWebhook: jest.fn().mockResolvedValue(handleWebhookResult),
    providers: new Map([['stripe', provider]]),
    _provider: provider,
  };
}

describe('createWebhookHandler', () => {
  let onPaymentSuccess;
  let onPaymentFailed;

  beforeEach(() => {
    onPaymentSuccess = jest.fn();
    onPaymentFailed = jest.fn();
  });

  test('responds 400 and skips callbacks when the signature is invalid', async () => {
    const gateway = makeGateway({ handleWebhookResult: false });
    const handler = createWebhookHandler(gateway, onPaymentSuccess, onPaymentFailed);
    const req = { params: { provider: 'stripe' }, body: {}, headers: {} };
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid signature' });
    expect(gateway._provider.processWebhook).not.toHaveBeenCalled();
    expect(onPaymentSuccess).not.toHaveBeenCalled();
    expect(onPaymentFailed).not.toHaveBeenCalled();
  });

  test('calls onPaymentSuccess for a payment_success event and acknowledges with 200', async () => {
    const gateway = makeGateway({ processWebhookResult: { type: 'payment_success', transactionId: 'tx1' } });
    const handler = createWebhookHandler(gateway, onPaymentSuccess, onPaymentFailed);
    const req = { params: { provider: 'stripe' }, body: { some: 'payload' }, headers: {} };
    const res = makeRes();

    await handler(req, res);

    expect(onPaymentSuccess).toHaveBeenCalledWith({ type: 'payment_success', transactionId: 'tx1' });
    expect(onPaymentFailed).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  test('calls onPaymentFailed for a payment_failed event', async () => {
    const gateway = makeGateway({ processWebhookResult: { type: 'payment_failed', transactionId: 'tx1' } });
    const handler = createWebhookHandler(gateway, onPaymentSuccess, onPaymentFailed);
    const req = { params: { provider: 'stripe' }, body: {}, headers: {} };
    const res = makeRes();

    await handler(req, res);

    expect(onPaymentFailed).toHaveBeenCalledWith({ type: 'payment_failed', transactionId: 'tx1' });
    expect(onPaymentSuccess).not.toHaveBeenCalled();
  });

  test('a refund event triggers neither callback but still acknowledges', async () => {
    const gateway = makeGateway({ processWebhookResult: { type: 'refund', transactionId: 'tx1' } });
    const handler = createWebhookHandler(gateway, onPaymentSuccess, onPaymentFailed);
    const res = makeRes();

    await handler({ params: { provider: 'stripe' }, body: {}, headers: {} }, res);

    expect(onPaymentSuccess).not.toHaveBeenCalled();
    expect(onPaymentFailed).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('an unrecognized event type still acknowledges with 200', async () => {
    const gateway = makeGateway({ processWebhookResult: { type: 'something_else' } });
    const handler = createWebhookHandler(gateway, onPaymentSuccess, onPaymentFailed);
    const res = makeRes();

    await handler({ params: { provider: 'stripe' }, body: {}, headers: {} }, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('responds 500 when the gateway throws (e.g. unknown provider)', async () => {
    const gateway = {
      handleWebhook: jest.fn().mockRejectedValue(new Error("Payment provider 'bogus' not available")),
      providers: new Map(),
    };
    const handler = createWebhookHandler(gateway, onPaymentSuccess, onPaymentFailed);
    const res = makeRes();

    await handler({ params: { provider: 'bogus' }, body: {}, headers: {} }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Webhook processing failed' });
  });
});

describe('setupWebhookRoutes', () => {
  test('registers the generic :provider route plus one dedicated route per named provider', () => {
    const app = { post: jest.fn() };
    const gateway = makeGateway();

    setupWebhookRoutes(app, gateway, { onPaymentSuccess: jest.fn(), onPaymentFailed: jest.fn() });

    const registeredPaths = app.post.mock.calls.map(call => call[0]);
    expect(registeredPaths).toEqual([
      '/webhooks/:provider',
      '/webhooks/stripe',
      '/webhooks/ecocash',
      '/webhooks/netone',
      '/webhooks/paynow',
    ]);
  });

  test('the dedicated /webhooks/stripe route forces req.params.provider to "stripe"', async () => {
    const app = { post: jest.fn() };
    const gateway = makeGateway();
    const onPaymentSuccess = jest.fn();

    setupWebhookRoutes(app, gateway, { onPaymentSuccess, onPaymentFailed: jest.fn() });

    const stripeRouteCall = app.post.mock.calls.find(call => call[0] === '/webhooks/stripe');
    // registered as app.post(path, express.raw(...), handler) — the actual handler is the last arg
    const stripeHandler = stripeRouteCall[stripeRouteCall.length - 1];

    const req = { params: {}, body: {}, headers: {} };
    const res = makeRes();
    await stripeHandler(req, res);

    expect(req.params.provider).toBe('stripe');
    expect(gateway.handleWebhook).toHaveBeenCalledWith('stripe', req.body, req.headers);
  });

  test('the dedicated /webhooks/ecocash route forces req.params.provider to "ecocash"', async () => {
    const app = { post: jest.fn() };
    const gateway = { handleWebhook: jest.fn().mockResolvedValue(false), providers: new Map() };

    setupWebhookRoutes(app, gateway, { onPaymentSuccess: jest.fn(), onPaymentFailed: jest.fn() });

    const ecocashHandler = app.post.mock.calls.find(call => call[0] === '/webhooks/ecocash')[1];
    const req = { params: {}, body: {}, headers: {} };
    await ecocashHandler(req, makeRes());

    expect(req.params.provider).toBe('ecocash');
    expect(gateway.handleWebhook).toHaveBeenCalledWith('ecocash', req.body, req.headers);
  });
});
