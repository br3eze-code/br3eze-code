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
      const result = await verifyWebhook.call(paymentPlatform, provider, req.body, req.headers);
      if (result === false || result?.valid === false) throw new Error('Invalid signature');
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
  return handler;
}
