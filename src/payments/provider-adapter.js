/**
 * Domain-neutral payment provider contract.
 * Providers implement this contract; domains never call provider SDKs directly.
 */
export class PaymentProviderAdapter {
  constructor(config = {}) {
    this.config = config;
    this.id = config.id || 'unknown';
    this.capabilities = Object.freeze({
      createPayment: false,
      verifyPayment: false,
      refunds: false,
      webhooks: false,
      reconciliation: false,
      ...config.capabilities,
    });
  }

  supports(operation) {
    return this.capabilities[operation] === true;
  }

  require(operation) {
    if (!this.supports(operation)) {
      throw new Error(`Provider '${this.id}' does not support '${operation}'`);
    }
  }

  async createPayment() { this.require('createPayment'); }
  async verifyPayment() { this.require('verifyPayment'); }
  async refund() { this.require('refunds'); }
  async verifyWebhook() { this.require('webhooks'); }
  async processWebhook() { this.require('webhooks'); }
  async reconcile() { this.require('reconciliation'); }
}

export function normalizePaymentResult(result = {}, provider) {
  return {
    provider,
    success: result.success ?? ['succeeded', 'completed', 'pending'].includes(String(result.status || '').toLowerCase()),
    status: String(result.status || 'unknown').toLowerCase(),
    transactionId: result.transactionId || result.id || null,
    reference: result.reference || null,
    amount: result.amount ?? null,
    currency: result.currency ? String(result.currency).toUpperCase() : null,
    checkoutUrl: result.checkoutUrl || result.redirectUrl || null,
    clientSecret: result.clientSecret || null,
    metadata: result.metadata || {},
    raw: result.raw,
  };
}
