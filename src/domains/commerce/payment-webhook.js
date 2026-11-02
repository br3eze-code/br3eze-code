import { createWebhookHandler } from '../../payments/webhook-handler.js';
import { reconcileCommercePayment } from './payment-reconciliation.js';

/**
 * Build the commerce webhook handler on top of the existing provider
 * verification boundary. Provider adapters authenticate and normalize the
 * event first; commerce reconciliation then performs the atomic order,
 * invoice, and transaction transition.
 *
 * The provider is taken from the route parameter, never from the webhook
 * payload, so the payload cannot redirect settlement to another provider.
 */
export function createCommerceWebhookHandler(gateway, { db = null, scope = {} } = {}) {
  if (!gateway) throw new TypeError('Payment gateway is required.');

  return async (req, res) => {
    const provider = String(req.params.provider || '').trim().toLowerCase();
    const reconcile = async (result) => {
      if (!result) return null;
      const type = String(result.type || '').toLowerCase();
      const status = result.status || ({
        payment_success: 'succeeded',
        'payment.succeeded': 'succeeded',
        payment_failed: 'failed',
        'payment.failed': 'failed',
      })[type];
      if (!['succeeded', 'successful', 'completed', 'paid', 'failed', 'cancelled', 'canceled', 'expired'].includes(String(status || '').toLowerCase())) return null;
      return reconcileCommercePayment({ ...result, provider, status }, { db, scope });
    };

    const handler = createWebhookHandler(gateway, reconcile, reconcile);
    return handler(req, res);
  };
}
