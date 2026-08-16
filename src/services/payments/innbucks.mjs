import crypto from 'node:crypto';

export class InnbucksAdapter {
  constructor({ mode = 'paynow', gateway = null, baseUrl = process.env.INNBUCKS_BASE_URL || process.env.PAYNOW_BASE_URL, integrationId = process.env.PAYNOW_INTEGRATION_ID, integrationKey = process.env.PAYNOW_INTEGRATION_KEY, transport = globalThis.fetch, timeoutMs = 15_000 } = {}) {
    this.mode = mode;
    this.gateway = gateway;
    this.baseUrl = baseUrl?.replace(/\/$/, '');
    this.integrationId = integrationId;
    this.integrationKey = integrationKey;
    this.transport = transport;
    this.timeoutMs = timeoutMs;
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.integrationId && this.integrationKey && this.transport);
  }

  async initiatePaynow({ amount, reference, customerEmail, customerPhone, returnUrl, resultUrl, description = 'AgentOS payment', metadata = {} } = {}) {
    if (this.gateway) {
      return this.gateway.createPayment('paynow', { amount: Number(amount), currency: 'USD', reference, description, email: customerEmail, phone: customerPhone, metadata, returnUrl, resultUrl });
    }
    return this.createPayment({ amountMinor: Math.round(Number(amount) * 100), currency: 'USD', reference, customer: { email: customerEmail, phone: customerPhone }, metadata });
  }

  async checkStatus(pollUrlOrReference) {
    if (this.gateway) return this.gateway.verifyPayment('paynow', pollUrlOrReference);
    return this.getPaymentStatus(pollUrlOrReference);
  }

  generateQRData(authorizationCodeOrUrl) {
    const value = String(authorizationCodeOrUrl || '');
    return { qrUrl: value, steps: ['Open the payment link or QR code.', 'Approve the payment in the Innbucks/Paynow app.', 'Return here and check the payment status.'] };
  }

  async createPayment({ amountMinor, currency = 'USD', reference, customer = {}, metadata = {} } = {}) {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('amountMinor must be a positive integer');
    if (!reference) throw new Error('reference is required');
    return this.#request('/payments', {
      method: 'POST',
      body: { amountMinor, currency, reference, customer, metadata, mode: this.mode, integrationId: this.integrationId },
      headers: { 'Idempotency-Key': reference },
    });
  }

  async getPaymentStatus(reference) {
    if (!reference) throw new Error('reference is required');
    return this.#request(`/payments/${encodeURIComponent(reference)}`);
  }

  async refund(reference, amountMinor, reason) {
    if (!reference || !Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('reference and positive amountMinor are required');
    return this.#request(`/payments/${encodeURIComponent(reference)}/refund`, { method: 'POST', body: { amountMinor, reason } });
  }

  verifyWebhookSignature(rawBody, signature) {
    if (!signature || !this.integrationKey) return false;
    const expected = crypto.createHmac('sha256', this.integrationKey).update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  async #request(path, { method = 'GET', body, headers = {} } = {}) {
    if (!this.transport) throw new Error('No payment transport configured');
    if (!this.baseUrl) throw new Error('INNBUCKS_BASE_URL or PAYNOW_BASE_URL is required');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport(`${this.baseUrl}${path}`, {
        method,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (!response.ok) throw new Error(`Payment provider ${response.status}: ${data.error || data.message || text}`);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }
}

export default InnbucksAdapter;
