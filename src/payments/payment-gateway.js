import { createPaymentPlatform } from './payment-platform.js';

/**
 * Compatibility facade for callers that have not yet migrated to PaymentPlatform.
 * No provider implementation belongs here.
 * @deprecated Use createPaymentPlatform() directly.
 */
export class PaymentGateway {
  constructor(config = {}) {
    this.platform = createPaymentPlatform(config);
    this.providers = this.platform.registry.adapters;
  }

  getAvailableMethods(options = {}) {
    return this.platform.getAvailablePaymentMethods(options);
  }

  async createPayment(provider, data = {}) {
    return this.platform.createPayment(provider, data);
  }

  async verifyPayment(provider, transaction) {
    return this.platform.verifyPayment(provider, transaction);
  }

  async handleWebhook(provider, payload = {}, headers = {}) {
    return this.platform.webhook(provider, payload, headers);
  }

  async refund(provider, transactionId, amount, reason = '') {
    return this.platform.refund(provider, transactionId, amount, reason);
  }
}

export default PaymentGateway;
