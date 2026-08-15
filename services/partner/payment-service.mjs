export class PaymentService {
  constructor({ providers = {}, db }) {
    this.providers = providers;
    this.db = db;
  }

  provider(name) {
    const provider = this.providers[name];
    if (!provider) throw new Error(`Payment provider not configured: ${name}`);
    return provider;
  }

  async createPayment({ provider: providerName, paymentId, amountMinor, currency, customer, metadata = {} }) {
    if (!paymentId) throw new TypeError('paymentId is required');
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      throw new TypeError('amountMinor must be a positive safe integer');
    }

    const provider = this.provider(providerName);
    const existing = this.db
      ? await this.db.collection('payments').doc(paymentId).get()
      : null;

    if (existing?.exists) return existing.data();

    const result = await provider.createPayment({
      paymentId,
      amountMinor,
      currency,
      customer,
      metadata,
    });

    const payment = {
      id: paymentId,
      provider: providerName,
      amountMinor,
      currency,
      status: result.status ?? 'pending',
      providerReference: result.providerReference ?? null,
      metadata,
      createdAt: new Date().toISOString(),
    };

    if (this.db) await this.db.collection('payments').doc(paymentId).set(payment);
    return payment;
  }

  async handleWebhook({ provider: providerName, event }) {
    const provider = this.provider(providerName);
    const normalized = await provider.verifyWebhook(event);

    if (!normalized?.paymentId) throw new Error('Verified payment webhook lacks paymentId');

    if (this.db) {
      await this.db.collection('payments').doc(normalized.paymentId).set(
        {
          ...normalized,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
    }

    return normalized;
  }
}
