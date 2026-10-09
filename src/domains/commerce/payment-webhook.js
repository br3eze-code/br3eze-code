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
      if (!result || !['payment_success', 'payment_failed'].includes(result.type)) return null;
      return reconcileCommercePayment({ ...result, provider }, { db, scope });
    };

    const handler = createWebhookHandler(gateway, reconcile, reconcile);
    return handler(req, res);
  };
}
