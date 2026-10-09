// src/payments/payment-service.js
// High-level payment service for business logic. Provider transport is owned by PaymentPlatform.

class PaymentService {
  constructor(paymentPlatform) {
    this.platform = paymentPlatform;
    this.db = null; // Set via setDatabase()
  }

  setDatabase(database) { this.db = database; }

  async createPayment({ provider, paymentId, amountMinor, currency, customer, metadata = {} }) {
    if (!provider) throw new TypeError('provider is required');
    if (!paymentId) throw new TypeError('paymentId is required');
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new TypeError('amountMinor must be a positive safe integer');
    if (this.db?.get) {
      const existing = await this.db.get('paymentTransactions', paymentId).catch(() => null);
      if (existing) return existing;
    }
    const result = await this.platform.createPayment(provider, { amount: amountMinor / 100, amountMinor, currency, reference: paymentId, customer, metadata });
    const payment = { id: paymentId, provider, amountMinor, currency, status: result.status || 'pending', providerReference: result.transactionId || result.providerReference || null, metadata, createdAt: new Date(), providerResult: result };
    if (this.db?.set) await this.db.set('paymentTransactions', paymentId, {
      transaction_id: paymentId, provider, reference: paymentId, amount_minor: amountMinor,
      currency, status: payment.status, provider_reference: payment.providerReference,
      metadata: { ...metadata, providerResult: result }
    });
    return payment;
  }

  async handleWebhook(provider, payload, headers = {}) {
    const result = await this.platform.webhook(provider, payload, headers);
    const paymentId = result?.paymentId || result?.transactionId || result?.id;
    if (this.db?.update && paymentId) await this.db.update('paymentTransactions', paymentId, {
      status: result?.status || result?.state || 'completed', provider,
      metadata: result, updated_at: new Date().toISOString()
    }).catch(() => {});
    return result;
  }

  async purchaseVoucher(params) {
    const { userId, voucherType, amount, currency, paymentMethod, customerPhone, customerEmail, metadata = {} } = params;
    const reference = `VOUCHER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const paymentResult = await this.platform.createPayment(paymentMethod, { amount, currency, description: `WiFi Voucher: ${voucherType}`, reference, phoneNumber: customerPhone, email: customerEmail, metadata: { userId, voucherType, ...metadata } });
    if (this.db?.set) await this.db.set('transactions', paymentResult.transactionId, {
      user_id: userId, voucher_type: voucherType, amount, currency, payment_method: paymentMethod,
      status: paymentResult.status, reference, transaction_id: paymentResult.transactionId,
      created_at: new Date().toISOString(), metadata: paymentResult
    });
    return { ...paymentResult, reference };
  }

  async processSuccessfulPayment(transactionId, provider) {
    const transaction = await this.platform.verifyPayment(provider, transactionId);
    if (!transaction.success) throw new Error('Payment not completed');
    if (this.db?.update) await this.db.update('transactions', transactionId, {
      status: 'completed', completed_at: new Date().toISOString(), payment_details: transaction
    });
    const voucherCode = this.generateVoucherCode();
    const voucher = { code: voucherCode, type: transaction.metadata?.voucherType || '1Day', amount: transaction.amount, currency: transaction.currency, transactionId, createdAt: new Date(), expiresAt: this.calculateExpiry(transaction.metadata?.voucherType), used: false };
    if (this.db?.set) await this.db.set('vouchers', voucherCode, voucher);

    return { success: true, voucher, transaction };
  }

  async getAvailablePaymentMethods(context = {}) { return this.platform.getAvailablePaymentMethods(context); }

  async processRefund(transactionId, provider, amount, reason) {
    const result = await this.platform.refund(provider, transactionId, amount, reason);
    if (this.db?.update) await this.db.update('transactions', transactionId, {
      refunded: true, refund_amount: amount, refund_reason: reason, refund_id: result.refundId,
      refunded_at: new Date().toISOString()
    });
    return result;
  }

  async getTransactionHistory(userId, options = {}) {
    if (!this.db?.query) return [];
    const { limit = 50, offset = 0 } = options;
    return this.db.query('transactions', { user_id: userId }, { orderBy: 'created_at', direction: 'desc', limit, offset });
  }

  generateVoucherCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return `${code.substr(0, 4)}-${code.substr(4, 4)}`;
  }

  calculateExpiry(type) {
    const now = new Date();
    const multipliers = { '1Hour': 1, '1Day': 24, '1Week': 24 * 7, '1Month': 24 * 30 };
    return new Date(now.getTime() + (multipliers[type] || 24) * 60 * 60 * 1000);
  }
}

export default PaymentService;
