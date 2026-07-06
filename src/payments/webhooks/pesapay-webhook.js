// src/payments/webhooks/pesapay-webhook.js
// Express handler for PesaPay IPN callbacks

const express = require('express');
const router = express.Router();

/**
 * Setup PesaPay webhook routes
 * @param {PaymentGateway} gateway - Payment gateway instance
 * @param {Object} callbacks - Callback functions
 */
function setupPesaPayWebhooks(gateway, callbacks) {
  
  // IPN Endpoint - PesaPay sends notifications here
  router.post('/ipn', express.urlencoded({ extended: true }), async (req, res) => {
    try {
      console.log('[PesaPay IPN Received]', req.body);
      
      // Verify the webhook
      const isValid = await gateway.handleWebhook('pesapay', req.body, req.headers);
      
      if (!isValid) {
        console.error('[PesaPay IPN] Invalid signature');
        return res.status(400).send('Invalid');
      }

      // Process the webhook
      const result = await gateway.providers.get('pesapay').processWebhook(req.body);
      
      // Handle based on status
      switch (result.type) {
        case 'payment_success':
          await callbacks.onPaymentSuccess({
            transactionId: result.transactionId,
            merchantReference: result.merchantReference,
            amount: result.amount,
            currency: result.currency,
            provider: 'pesapay'
          });
          break;
          
        case 'payment_failed':
          await callbacks.onPaymentFailed({
            transactionId: result.transactionId,
            reason: 'Payment failed or cancelled',
            provider: 'pesapay'
          });
          break;
          
        case 'payment_reversed':
          await callbacks.onRefundProcessed({
            transactionId: result.transactionId,
            amount: result.amount,
            provider: 'pesapay'
          });
          break;
      }

      // IMPORTANT: Must respond with "OK" for PesaPay to stop retrying
      res.status(200).send('OK');
      
    } catch (error) {
      console.error('[PesaPay IPN Error]', error);
      // Still return 200 to prevent PesaPay from retrying
      res.status(200).send('OK');
    }
  });

  // Status check endpoint (for manual verification)
  router.get('/status/:orderTrackingId', async (req, res) => {
    try {
      const { orderTrackingId } = req.params;
      const status = await gateway.verifyPayment('pesapay', orderTrackingId);
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Register IPN URL (call this once during setup)
  router.post('/register-ipn', async (req, res) => {
    try {
      const pesapay = gateway.providers.get('pesapay');
      const { url, method = 'POST' } = req.body;
      
      const result = await pesapay.registerIPN(url, method);
      res.json({
        success: true,
        ipnId: result.ipn_id,
        url: result.url,
        method: result.method
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

module.exports = setupPesaPayWebhooks;
