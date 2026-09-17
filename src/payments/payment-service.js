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
    if (this.db) {
      const existingRef = this.db.collection('payments').doc(paymentId);
      const existing = await existingRef.get();
      if (existing?.exists) return existing.data();
    }
    const result = await this.platform.createPayment(provider, { amount: amountMinor / 100, amountMinor, currency, reference: paymentId, customer, metadata });
    const payment = { id: paymentId, provider, amountMinor, currency, status: result.status || 'pending', providerReference: result.transactionId || result.providerReference || null, metadata, createdAt: new Date(), providerResult: result };
    if (this.db) await this.db.collection('payments').doc(paymentId).set(payment);
    return payment;
  }

  async handleWebhook(provider, payload, headers = {}) {
    const result = await this.platform.webhook(provider, payload, headers);
    const paymentId = result?.paymentId || result?.transactionId || result?.id;
    if (this.db && paymentId) await this.db.collection('payments').doc(paymentId).set({ ...result, id: paymentId, provider, updatedAt: new Date() }, { merge: true });
    return result;
  }

  async purchaseVoucher(params) {
    const { userId, voucherType, amount, currency, paymentMethod, customerPhone, customerEmail, metadata = {} } = params;
    const reference = `VOUCHER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const paymentResult = await this.platform.createPayment(paymentMethod, { amount, currency, description: `WiFi Voucher: ${voucherType}`, reference, phoneNumber: customerPhone, email: customerEmail, metadata: { userId, voucherType, ...metadata } });
    if (this.db) await this.db.collection('transactions').doc(paymentResult.transactionId).set({ userId, voucherType, amount, currency, paymentMethod, status: paymentResult.status, reference, transactionId: paymentResult.transactionId, createdAt: new Date(), metadata: paymentResult });
    return { ...paymentResult, reference };
  }

  async processSuccessfulPayment(transactionId, provider) {
    const transaction = await this.platform.verifyPayment(provider, transactionId);
    if (!transaction.success) throw new Error('Payment not completed');
    if (this.db) await this.db.collection('transactions').doc(transactionId).update({ status: 'completed', completedAt: new Date(), paymentDetails: transaction });
    const voucherCode = this.generateVoucherCode();
    const voucher = { code: voucherCode, type: transaction.metadata?.voucherType || '1Day', amount: transaction.amount, currency: transaction.currency, transactionId, createdAt: new Date(), expiresAt: this.calculateExpiry(transaction.metadata?.voucherType), used: false };
    if (this.db) {
      await this.db.collection('vouchers').doc(voucherCode).set(voucher);
      if (transaction.metadata?.userId) await this.db.collection('users').doc(transaction.metadata.userId).collection('vouchers').add(voucher);
    }
    return { success: true, voucher, transaction };
  }

  async getAvailablePaymentMethods(context = {}) { return this.platform.getAvailablePaymentMethods(context); }

  async processRefund(transactionId, provider, amount, reason) {
    const result = await this.platform.refund(provider, transactionId, amount, reason);
    if (this.db) await this.db.collection('transactions').doc(transactionId).update({ refunded: true, refundAmount: amount, refundReason: reason, refundId: result.refundId, refundedAt: new Date() });
    return result;
  }

  async getTransactionHistory(userId, options = {}) {
    if (!this.db) return [];
    const { limit = 50, offset = 0 } = options;
    const snapshot = await this.db.collection('transactions').where('userId', '==', userId).orderBy('createdAt', 'desc').limit(limit).offset(offset).get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
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
