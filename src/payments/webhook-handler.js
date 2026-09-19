/**
 * Domain-neutral payment webhook boundary.
 * Provider verification and normalization are owned by PaymentPlatform/adapters.
 */
export function createWebhookHandler(paymentPlatform, onPaymentSuccess = async () => {}, onPaymentFailed = async () => {}) {
  return async (req, res) => {
    const provider = req.params.provider;
    try {
      let result;
      if (typeof paymentPlatform.webhook === 'function') {
        result = await paymentPlatform.webhook(provider, req.body, req.headers);
      } else {
        const verified = await paymentPlatform.handleWebhook(provider, req.body, req.headers);
        if (!verified) throw new Error('Invalid signature');
        const adapter = paymentPlatform.providers?.get(provider);
        if (!adapter?.processWebhook) throw new Error(`Payment provider '${provider}' not available`);
        result = await adapter.processWebhook(req.body, { headers: req.headers });
      }
      switch (result?.type) {
        case 'payment_success': await onPaymentSuccess(result); break;
        case 'payment_failed': await onPaymentFailed(result); break;
        case 'refund': break;
        default: break;
      }
      return res.status(200).json({ received: true });
    } catch (error) {
      const status = /signature|verification/i.test(error.message) ? 400 : 500;
      return res.status(status).json({ error: status === 400 ? 'Invalid signature' : 'Webhook processing failed' });
    }
  };
}

export function setupWebhookRoutes(app, paymentPlatform, callbacks = {}) {
  const handler = createWebhookHandler(paymentPlatform, callbacks.onPaymentSuccess, callbacks.onPaymentFailed);
  app.post('/webhooks/:provider', handler);
  for (const provider of ['stripe', 'ecocash', 'netone', 'paynow']) {
    app.post(`/webhooks/${provider}`, (req, res) => {
      req.params = { ...(req.params || {}), provider };
      return handler(req, res);
    });
  }
  return handler;
}
