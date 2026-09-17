import crypto from 'node:crypto';
import { PaymentProviderAdapter, normalizePaymentResult } from '../provider-adapter.js';

const DEFAULT_BASE_URL = 'https://www.paynow.co.zw/interface';

function parseFormEncoded(text) {
  return Object.fromEntries(new URLSearchParams(text));
}

function createHash(values, integrationKey) {
  const concatenated = Object.entries(values)
    .filter(([key]) => key.toLowerCase() !== 'hash')
    .map(([, value]) => String(value ?? '').trim())
    .join('');
  return crypto.createHash('sha512').update(`${concatenated}${integrationKey}`, 'utf8').digest('hex').toUpperCase();
}

export default class PaynowProvider extends PaymentProviderAdapter {
  constructor(config = {}) {
    super({
      id: 'paynow',
      capabilities: { createPayment: true, verifyPayment: true, refunds: false, webhooks: true, reconciliation: false },
    });
    this.baseUrl = config.paynowBaseUrl || process.env.PAYNOW_BASE_URL || DEFAULT_BASE_URL;
    this.integrationId = config.paynowIntegrationId || process.env.PAYNOW_INTEGRATION_ID;
    this.integrationKey = config.paynowIntegrationKey || process.env.PAYNOW_INTEGRATION_KEY;
    this.resultUrl = config.paynowResultUrl || process.env.PAYNOW_RESULT_URL;
    this.returnUrl = config.paynowReturnUrl || process.env.PAYNOW_RETURN_URL;
  }

  headers() {
    if (!this.integrationId || !this.integrationKey) throw new Error('Paynow integration credentials are not configured');
    return { 'Content-Type': 'application/x-www-form-urlencoded' };
  }

  verifyHash(payload) {
    if (!payload?.hash || !this.integrationKey) return false;
    const expected = createHash(payload, this.integrationKey);
    const actual = String(payload.hash).toUpperCase();
    return actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  }

  async post(path, fields) {
    const body = new URLSearchParams(fields);
    const response = await fetch(`${this.baseUrl}${path}`, { method: 'POST', headers: this.headers(), body });
    const text = await response.text();
    const parsed = parseFormEncoded(text);
    if (!response.ok) throw new Error(`Paynow request failed (${response.status})`);
    if (!this.verifyHash(parsed) && String(parsed.status || '').toLowerCase() !== 'error') {
      throw new Error('Paynow response hash verification failed');
    }
    return parsed;
  }

  async createPayment(data) {
    this.require('createPayment');
    if (!this.resultUrl || !this.returnUrl) throw new Error('Paynow result/return URLs are not configured');
    const fields = {
      id: this.integrationId,
      reference: data.reference,
      amount: Number(data.amount).toFixed(2),
      additionalinfo: data.description || '',
      returnurl: data.returnUrl || this.returnUrl,
      resulturl: data.resultUrl || this.resultUrl,
      status: 'Message',
      merchanttrace: data.merchantTrace || String(data.reference).slice(0, 32),
    };
    if (data.customerEmail) fields.authemail = data.customerEmail;
    if (data.customerPhone) fields.authphone = data.customerPhone;
    fields.hash = createHash(fields, this.integrationKey);
    const result = await this.post('/initiatetransaction', fields);
    if (String(result.status).toLowerCase() === 'error') throw new Error(result.error || 'Paynow transaction initiation failed');
    return normalizePaymentResult({
      provider: this.id,
      success: false,
      status: 'pending',
      transactionId: result.paynowreference || data.reference,
      reference: data.reference,
      amount: data.amount,
      currency: data.currency,
      checkoutUrl: result.browserurl,
      metadata: { pollUrl: result.pollurl },
      raw: result,
    }, this.id);
  }

  async verifyPayment(transaction) {
    this.require('verifyPayment');
    const pollUrl = typeof transaction === 'string' && transaction.startsWith('http') ? transaction : null;
    if (!pollUrl) throw new Error('Paynow verification requires the provider poll URL returned at initiation');
    const response = await fetch(pollUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '' });
    const parsed = parseFormEncoded(await response.text());
    if (!this.verifyHash(parsed)) throw new Error('Paynow status hash verification failed');
    return this.normalizeStatus(parsed);
  }

  normalizeStatus(result) {
    const status = String(result.status || 'unknown').toLowerCase();
    const terminal = ['paid', 'awaiting delivery', 'delivered', 'refunded', 'cancelled', 'disputed'].includes(status);
    return normalizePaymentResult({
      provider: this.id,
      success: ['paid', 'awaiting delivery', 'delivered'].includes(status),
      status: status === 'paid' ? 'succeeded' : status,
      transactionId: result.paynowreference || result.reference,
      reference: result.reference,
      amount: result.amount,
      currency: result.currency,
      metadata: { terminal, pollUrl: result.pollurl, paymentChannel: result.paymentchannel },
      raw: result,
    }, this.id);
  }

  async verifyWebhook(payload) {
    this.require('webhooks');
    return this.verifyHash(payload);
  }

  async processWebhook(payload) {
    this.require('webhooks');
    if (!this.verifyHash(payload)) throw new Error('Paynow webhook hash verification failed');
    return this.normalizeStatus(payload);
  }
}
