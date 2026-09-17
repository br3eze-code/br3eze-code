import { PaymentProviderAdapter, normalizePaymentResult } from '../provider-adapter.js';

const DEFAULT_BASE_URL = 'https://gateway.finivex.online/api/pg';

export default class FinivexProvider extends PaymentProviderAdapter {
  constructor(config = {}) {
    super({
      id: 'finivex',
      capabilities: { createPayment: true, verifyPayment: true, refunds: false, webhooks: true, reconciliation: false },
    });
    this.baseUrl = config.finivexBaseUrl || process.env.FINIVEX_BASE_URL || DEFAULT_BASE_URL;
    this.apiKey = config.finivexApiKey || process.env.FINIVEX_API_KEY;
    this.apiSecret = config.finivexApiSecret || process.env.FINIVEX_API_SECRET;
  }

  headers() {
    if (!this.apiKey || !this.apiSecret) throw new Error('Finivex API credentials are not configured');
    return { 'Content-Type': 'application/json', 'X-API-Key': this.apiKey, 'X-API-Secret': this.apiSecret };
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, { ...options, headers: { ...this.headers(), ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) throw new Error(body.errorMessage || body.message || `Finivex request failed (${response.status})`);
    return body;
  }

  async createPayment(data) {
    this.require('createPayment');
    const body = await this.request('/v1/payments/hosted-checkout', {
      method: 'POST',
      body: JSON.stringify({
        transactionId: data.reference,
        amount: data.amount,
        currency: data.currency,
        description: data.description,
        returnUrl: data.returnUrl,
        cancelUrl: data.cancelUrl,
      }),
    });
    const result = body.data || body;
    return normalizePaymentResult({ provider: this.id, success: true, status: 'pending', transactionId: result.orderId || result.transactionRef, reference: result.transactionRef, amount: result.amount, currency: result.currency, checkoutUrl: result.redirectUrl, raw: body }, this.id);
  }

  async verifyPayment(reference) {
    this.require('verifyPayment');
    const body = await this.request(`/v1/payments/status?transactionId=${encodeURIComponent(reference)}`, { method: 'GET' });
    const result = body.data || body;
    return normalizePaymentResult({ provider: this.id, success: ['COMPLETED', 'PAID', 'SUCCEEDED'].includes(String(result.status).toUpperCase()), status: result.status, transactionId: result.transactionId || reference, reference: result.transactionId || reference, amount: result.amount, currency: result.currency, raw: body }, this.id);
  }
}
