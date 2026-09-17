import { PaymentProviderAdapter, normalizePaymentResult } from '../provider-adapter.js';

const DEFAULT_BASE_URL = 'https://smileandpay.zb.co.zw';

export default class SmilePayProvider extends PaymentProviderAdapter {
  constructor(config = {}) {
    super({
      id: 'smilepay',
      capabilities: { createPayment: true, verifyPayment: true, refunds: false, webhooks: true, reconciliation: false },
    });
    this.baseUrl = config.smilepayBaseUrl || process.env.SMILEPAY_BASE_URL || DEFAULT_BASE_URL;
    this.apiKey = config.smilepayApiKey || process.env.SMILEPAY_API_KEY;
  }

  headers() {
    if (!this.apiKey) throw new Error('Smile&Pay API credentials are not configured');
    return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
  }

  async request(path, body) {
    const response = await fetch(`${this.baseUrl}${path}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || `Smile&Pay request failed (${response.status})`);
    return result;
  }

  async createPayment(data) {
    this.require('createPayment');
    const body = await this.request('/payments/initiate-transaction', {
      reference: data.reference,
      amount: data.amount,
      currency: data.currency,
      description: data.description,
      callbackUrl: data.callbackUrl,
      returnUrl: data.returnUrl,
    });
    return normalizePaymentResult({ provider: this.id, success: false, status: body.status || 'pending', transactionId: body.transactionId || body.reference, reference: data.reference, amount: data.amount, currency: data.currency, checkoutUrl: body.checkoutUrl || body.redirectUrl, raw: body }, this.id);
  }

  async verifyPayment(reference) {
    this.require('verifyPayment');
    const response = await fetch(`${this.baseUrl}/payments/transaction/${encodeURIComponent(reference)}/status/check`, { method: 'GET', headers: this.headers() });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `Smile&Pay status check failed (${response.status})`);
    const status = body.status || body.transactionStatus || 'unknown';
    return normalizePaymentResult({ provider: this.id, success: ['success', 'successful', 'completed', 'paid'].includes(String(status).toLowerCase()), status, transactionId: body.transactionId || reference, reference, amount: body.amount, currency: body.currency, raw: body }, this.id);
  }
}
