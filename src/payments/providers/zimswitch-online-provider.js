import { PaymentProviderAdapter, normalizePaymentResult } from '../provider-adapter.js';

const DEFAULT_BASE_URL = 'https://gateway.zimswitch.co.zw';

export default class ZimswitchOnlineProvider extends PaymentProviderAdapter {
  constructor(config = {}) {
    super({
      id: 'zimswitch_online',
      capabilities: { createPayment: true, verifyPayment: true, refunds: false, webhooks: false, reconciliation: false },
    });
    this.baseUrl = config.zimswitchBaseUrl || process.env.ZIMSWITCH_BASE_URL || DEFAULT_BASE_URL;
    this.entityId = config.zimswitchEntityId || process.env.ZIMSWITCH_ENTITY_ID;
    this.authorizationBearer = config.zimswitchAuthorizationBearer || process.env.ZIMSWITCH_AUTHORIZATION_BEARER;
  }

  headers() {
    if (!this.entityId || !this.authorizationBearer) throw new Error('Zimswitch Online credentials are not configured');
    return { Authorization: this.authorizationBearer.startsWith('Bearer ') ? this.authorizationBearer : `Bearer ${this.authorizationBearer}` };
  }

  async createPayment(data) {
    this.require('createPayment');
    const params = new URLSearchParams({ entityId: this.entityId, amount: String(data.amount), currency: data.currency, paymentType: data.paymentType || 'DB' });
    const response = await fetch(`${this.baseUrl}/v1/checkouts`, { method: 'POST', headers: { ...this.headers(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `Zimswitch checkout failed (${response.status})`);
    return normalizePaymentResult({ provider: this.id, success: false, status: 'pending', transactionId: body.id || body.checkoutId, reference: data.reference, amount: data.amount, currency: data.currency, checkoutUrl: body.checkoutUrl, metadata: { resourcePath: body.resourcePath }, raw: body }, this.id);
  }

  async verifyPayment(resourcePath) {
    this.require('verifyPayment');
    if (!resourcePath) throw new Error('Zimswitch resourcePath is required for server-side verification');
    const response = await fetch(resourcePath, { method: 'GET', headers: this.headers() });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `Zimswitch verification failed (${response.status})`);
    const success = String(body.result?.code || body.result?.description || body.status || '').toLowerCase().includes('success') || body.result?.rspCode === '00';
    return normalizePaymentResult({ provider: this.id, success, status: success ? 'succeeded' : 'failed', transactionId: body.id || body.checkoutId, amount: body.amount, currency: body.currency, raw: body }, this.id);
  }
}
