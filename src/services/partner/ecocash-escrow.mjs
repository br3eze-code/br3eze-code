import crypto from 'node:crypto';

export class EcoCashEscrow {
  constructor({ db, ecocash, walletCredit = null, now = () => new Date() } = {}) {
    if (!db) throw new TypeError('EcoCashEscrow requires db');
    if (!ecocash) throw new TypeError('EcoCashEscrow requires ecocash');
    this.db = db;
    this.ecocash = ecocash;
    this.walletCredit = walletCredit;
    this.now = now;
  }

  async createJob(partnerId, customerPhone, services = []) {
    if (!partnerId || !customerPhone || !Array.isArray(services) || services.length === 0) {
      throw new TypeError('partnerId, customerPhone, and services are required');
    }
    const partner = await this._getPartner(partnerId);
    const total = services.reduce((sum, item) => sum + Number(item.price || 0), 0);
    if (!Number.isFinite(total) || total <= 0) throw new Error('Escrow total must be positive');
    const commissionRate = Number(partner.commission?.install ?? partner.commission?.voucher ?? 0);
    if (commissionRate < 0 || commissionRate > 1) throw new Error('Invalid partner commission');
    const partnerShare = Math.round(total * commissionRate * 100) / 100;
    const platformShare = Math.round((total - partnerShare) * 100) / 100;
    const escrowId = `esc-${this.now().getTime()}-${crypto.randomUUID()}`;
    const currency = partner.currency || this.ecocash.currency || 'USD';
    await this.db.collection('escrow').doc(escrowId).set({
      partnerId: String(partnerId),
      customerPhone,
      amount: total,
      partnerShare,
      platformShare,
      currency,
      status: 'awaiting_payment',
      services,
      createdAt: this.now().toISOString(),
    });
    return { escrowId, total, partnerShare, platformShare, currency };
  }

  async collectPayment(escrowId) {
    const record = await this._getEscrow(escrowId);
    if (!record) throw new Error('Escrow not found');
    if (record.status === 'released') return { status: 'already_released', transactionId: record.transactionId };
    if (record.status === 'payment_pending' && record.transactionId) return { status: 'already_pending', transactionId: record.transactionId };
    const payment = await this._initiatePayment(record, escrowId);
    const transactionId = payment.transactionId || payment.providerReference || payment.id;
    if (!transactionId) throw new Error('EcoCash payment did not return a transaction ID');
    await this.db.collection('escrow').doc(escrowId).update({ transactionId, status: 'payment_pending', initiatedAt: this.now().toISOString() });
    return { status: 'ussd_pushed', message: 'Payment prompt sent to the customer.', transactionId };
  }

  async verifyAndRelease(escrowId) {
    const record = await this._getEscrow(escrowId);
    if (!record) throw new Error('Escrow not found');
    if (record.status === 'released') return { status: 'released', partnerShare: record.partnerShare, alreadyProcessed: true };
    if (!record.transactionId) throw new Error('No transaction ID');
    const status = await this._checkStatus(record.transactionId);
    const normalized = String(status.status || '').toUpperCase();
    if (normalized === 'SUCCESS' || normalized === 'SUCCESSFUL' || status.success === true) {
      await this._creditPartner(record);
      await this.db.collection('escrow').doc(escrowId).update({ status: 'released', releasedAt: this.now().toISOString(), ecocashReference: status.reference || status.transactionId || record.transactionId });
      return { status: 'released', partnerShare: record.partnerShare };
    }
    if (normalized === 'FAILED' || normalized === 'FAILURE') {
      await this.db.collection('escrow').doc(escrowId).update({ status: 'failed', failureReason: status.reason || 'Customer declined or timeout' });
      return { status: 'failed', reason: status.reason };
    }
    return { status: 'pending', message: 'Waiting for customer confirmation' };
  }

  async pollLoop(escrowId, { maxAttempts = 30, intervalMs = 5000 } = {}) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const result = await this.verifyAndRelease(escrowId);
      if (result.status !== 'pending') return result;
      if (intervalMs > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    await this.db.collection('escrow').doc(escrowId).update({ status: 'timeout', timedOutAt: this.now().toISOString() });
    return { status: 'timeout', message: 'Payment not confirmed in time.' };
  }

  async _getPartner(partnerId) {
    const doc = await this.db.collection('tenants').doc(String(partnerId)).get();
    if (!doc?.exists) throw new Error('Partner not found');
    return doc.data();
  }

  async _getEscrow(escrowId) {
    const doc = await this.db.collection('escrow').doc(String(escrowId)).get();
    return doc?.exists ? { id: doc.id || escrowId, ...doc.data() } : null;
  }

  async _initiatePayment(record, escrowId) {
    if (typeof this.ecocash.initiatePayment === 'function') {
      return this.ecocash.initiatePayment({ amount: record.amount, phone: record.customerPhone, reference: escrowId, description: `AgentOS partner payment for ${record.services.map((item) => item.name).join(', ')}` });
    }
    if (typeof this.ecocash.createPayment === 'function') {
      return this.ecocash.createPayment({ amount: record.amount, currency: record.currency, reference: escrowId, phoneNumber: record.customerPhone, description: 'AgentOS partner payment' });
    }
    throw new Error('EcoCash adapter has no payment initiation method');
  }

  async _checkStatus(transactionId) {
    if (typeof this.ecocash.checkStatus === 'function') return this.ecocash.checkStatus(transactionId);
    if (typeof this.ecocash.verifyPayment === 'function') return this.ecocash.verifyPayment(transactionId);
    throw new Error('EcoCash adapter has no payment verification method');
  }

  async _creditPartner(record) {
    if (this.walletCredit) return this.walletCredit(record.partnerId, record.partnerShare, record.currency, `EcoCash escrow ${record.id}`);
    if (typeof this.db.updateWallet === 'function') return this.db.updateWallet(record.partnerId, Number(record.partnerShare), record.currency, `EcoCash escrow ${record.id}`);
    throw new Error('No partner wallet credit function configured');
  }
}

export default EcoCashEscrow;
