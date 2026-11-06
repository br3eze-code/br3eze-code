/**
 * Domain-neutral payment webhook boundary.
 * Provider verification and normalization are owned by PaymentPlatform/adapters.
 */
export function createWebhookHandler(paymentPlatform, onPaymentSuccess = async () => {}, onPaymentFailed = async () => {}) {
  return async (req, res) => {
    const provider = req.params.provider;
    try {
      const verifyWebhook = paymentPlatform.webhook || paymentPlatform.handleWebhook;
      if (typeof verifyWebhook !== 'function') throw new TypeError('Payment platform must implement webhook() or handleWebhook()');
      let result = await verifyWebhook.call(paymentPlatform, provider, req.body, req.headers);
      if (result === false || result?.valid === false) throw new Error('Invalid signature');
      // Legacy gateways split signature verification from provider event parsing.
      if (result === true) {
        const adapter = paymentPlatform.providers?.get?.(provider);
        result = typeof adapter?.processWebhook === 'function'
          ? await adapter.processWebhook(req.body, req.headers)
          : {};
      }
      switch (String(result?.type || '').toLowerCase()) {
        case 'payment_success':
        case 'payment.succeeded': await onPaymentSuccess(result); break;
        case 'payment_failed':
        case 'payment.failed': await onPaymentFailed(result); break;
        case 'refund':
        case 'payment.refunded': break;
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
  const providers = ['stripe', 'ecocash', 'netone', 'paynow'];
  // Pinned routes must precede the generic parameter route.
  for (const provider of providers) {
    app.post('/webhooks/' + provider, (req, res, next) => {
      req.params = { ...(req.params || {}), provider };
      return handler(req, res, next);
    });
  }
  app.post('/webhooks/:provider', handler);
  return handler;
}
