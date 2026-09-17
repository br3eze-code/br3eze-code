import { createPaymentPlatform } from './payment-platform.js';
import { createPaymentIdempotencyStore } from './idempotency-store.js';
import { normalizePaymentRequest, createIdempotencyKey, assertTransactionId } from './payment-guards.js';

/**
 * Compatibility facade for existing callers.
 *
 * Provider transport, credentials, signing and webhook logic do not belong here.
 * They live behind PaymentPlatform/provider adapters. This facade exists only
 * while domain callers migrate from the historic PaymentGateway API.
 */
export class PaymentGateway {
  constructor(config = {}) {
    this.config = { defaultCurrency: config.defaultCurrency || 'USD', ...config };
    this.platform = config.platform || createPaymentPlatform(this.config);
    this.registry = this.platform.registry;
    this.providers = new Map(this.registry.adapters || []);
    this.transactionSink = typeof config.transactionSink === 'function' ? config.transactionSink : null;
    this.idempotency = config.idempotencyStore || createPaymentIdempotencyStore(config.idempotencyOptions);
  }

  getAvailableMethods({ country = this.config.merchantCountry || 'ZW' } = {}) {
    return this.registry.list()
      .map(({ id, capabilities }) => ({
        id,
        name: id,
        type: capabilities.paymentMethodType || capabilities.rail || 'payment',
        countries: capabilities.countries || [country],
        capabilities,
      }))
      .filter((method) => method.countries.includes('*') || method.countries.includes(country));
  }

  async createPayment(provider, paymentData = {}) {
    const normalized = normalizePaymentRequest(paymentData, { defaultCurrency: this.config.defaultCurrency });
    const key = paymentData.idempotencyKey || createIdempotencyKey(provider, normalized.reference);
    const previous = this.idempotency.get(key);
    if (previous) return previous;

    if (typeof this.idempotency.reserve === 'function' && !this.idempotency.reserve(key, {
      provider, reference: normalized.reference, amount: normalized.amount, currency: normalized.currency,
    })) {
      const concurrent = this.idempotency.get(key);
      if (concurrent) return concurrent;
      throw new Error('Payment request is already being processed');
    }

    try {
      const result = await this.platform.createPayment({ provider, ...normalized, idempotencyKey: key });
      this.idempotency.set(key, result);
      await this.logTransaction({ provider, ...normalized, status: result.status, transactionId: result.transactionId });
      return result;
    } catch (error) {
      await this.logTransaction({ provider, ...normalized, status: 'failed', error: error.message });
      throw error;
    }
  }

  async verifyPayment(provider, transactionId) {
    return this.platform.verifyPayment({ provider, transaction: assertTransactionId(transactionId) });
  }

  async handleWebhook(provider, payload = {}, headers = {}) {
    return this.platform.webhook({ provider, payload, headers });
  }

  async refund(provider, transactionId, amount, reason = '') {
    return this.platform.refund({ provider, transaction: assertTransactionId(transactionId), amount, reason });
  }

  async logTransaction(transaction) {
    const record = {
      id: transaction.transactionId || transaction.reference || createIdempotencyKey(transaction.provider || 'unknown', transaction.reference || Date.now()),
      type: 'payment_attempt',
      provider: transaction.provider || null,
      transactionId: transaction.transactionId || null,
      reference: transaction.reference || null,
      status: transaction.status || 'unknown',
      amount: transaction.amount ?? null,
      currency: transaction.currency || this.config.defaultCurrency,
      metadata: transaction.metadata || {},
      createdAt: new Date().toISOString(),
    };
    if (this.transactionSink) await this.transactionSink(record);
    return record;
  }
}

export default PaymentGateway;
