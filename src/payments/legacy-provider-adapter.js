import { PaymentProviderAdapter, normalizePaymentResult } from './provider-adapter.js';

/** Transitional bridge: exposes existing provider implementations through the canonical adapter contract. */
export class LegacyProviderAdapter extends PaymentProviderAdapter {
  constructor(id, provider, config = {}) {
    super({
      id,
      capabilities: {
        createPayment: typeof provider?.createPayment === 'function',
        verifyPayment: typeof provider?.verifyPayment === 'function',
        refunds: typeof provider?.refund === 'function',
        webhooks: typeof provider?.verifyWebhook === 'function' && typeof provider?.processWebhook === 'function',
        reconciliation: typeof provider?.reconcile === 'function',
        ...config.capabilities,
      },
    });
    this.provider = provider;
  }

  async createPayment(data) {
    this.require('createPayment');
    return normalizePaymentResult(await this.provider.createPayment(data), this.id);
  }

  async verifyPayment(transaction) {
    this.require('verifyPayment');
    return normalizePaymentResult(await this.provider.verifyPayment(transaction), this.id);
  }

  async refundPayment(transaction, data = {}) {
    this.require('refunds');
    return normalizePaymentResult(
      await this.provider.refund(transaction, data.amount ?? data.refundAmount, data.reason || ''),
      this.id,
    );
  }

  async verifyWebhook(payload, headers = {}) {
    this.require('webhooks');
    return this.provider.verifyWebhook(payload, headers);
  }

  async processWebhook(payload, context = {}) {
    this.require('webhooks');
    return normalizePaymentResult(await this.provider.processWebhook(payload, context), this.id);
  }

  async reconcile(...args) {
    this.require('reconciliation');
    return this.provider.reconcile(...args);
  }
}

export default LegacyProviderAdapter;
