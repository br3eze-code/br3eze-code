import crypto from 'crypto';
import express from 'express';

// src/payments/webhook-handler.js
// Express middleware for handling payment webhooks

/**
 * Create webhook handler middleware
 * @param {PaymentGateway} gateway - Payment gateway instance
 * @param {Function} onPaymentSuccess - Callback for successful payments
 * @param {Function} onPaymentFailed - Callback for failed payments
 */
function createWebhookHandler(gateway, onPaymentSuccess, onPaymentFailed) {
  return async (req, res) => {
    const provider = req.params.provider;
    
    try {
      // The gateway verifies the signature and processes the event atomically.
      // Do not call processWebhook a second time: duplicate provider processing
      // can repeat settlement, fulfillment, or callback side effects.
      const verifiedResult = await gateway.handleWebhook(
        provider,
        req.body,
        req.headers
      );

      if (verifiedResult === false) {
        return res.status(400).json({ error: 'Invalid signature' });
      }

      // Current gateways return the processed event. The boolean `true`
      // branch is retained only for legacy adapters/tests that expose
      // verification separately; production gateways are never processed twice.
      const result = verifiedResult === true
        ? await gateway.providers.get(provider).processWebhook(req.body)
        : verifiedResult;

      // Handle different event types
      switch (result?.type) {
        case 'payment_success':
          await onPaymentSuccess(result);
          break;
        case 'payment_failed':
          await onPaymentFailed(result);
          break;
        case 'refund':
          // Handle refund notification
          break;
        default:
          console.log(`Unhandled webhook type: ${result.type}`);
      }

      // Acknowledge receipt
      res.status(200).json({ received: true });
      
    } catch (error) {
      console.error(`Webhook error for ${provider}:`, error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  };
}

// Express route setup helper
function setupWebhookRoutes(app, gateway, callbacks) {
  const handler = createWebhookHandler(
    gateway,
    callbacks.onPaymentSuccess,
    callbacks.onPaymentFailed
  );

  // Register webhook endpoints for each provider
  app.post('/webhooks/:provider', express.raw({ type: 'application/json' }), handler);
  
  // Provider-specific endpoints (some require specific paths)
  app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
    req.params.provider = 'stripe';
    handler(req, res);
  });
  
  app.post('/webhooks/ecocash', (req, res) => {
    req.params.provider = 'ecocash';
    handler(req, res);
  });
  
  app.post('/webhooks/netone', (req, res) => {
    req.params.provider = 'netone';
    handler(req, res);
  });
  
  app.post('/webhooks/paynow', (req, res) => {
    req.params.provider = 'paynow';
    handler(req, res);
  });
}

export { createWebhookHandler, setupWebhookRoutes };