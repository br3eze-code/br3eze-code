// Mastercard provider boundary.
// This adapter intentionally fails closed until the real Mastercard A2A
// authentication, request signing, webhook verification and API endpoints
// are configured and tested. It must never fabricate payment state.

import fs from 'fs';

class MastercardProvider {
  constructor(config = {}) {
    this.config = {
      consumerKey: process.env.MC_CONSUMER_KEY || config.consumerKey || null,
      privateKeyPath: process.env.MC_PRIVATE_KEY_PATH || config.privateKeyPath || null,
      environment: process.env.MC_ENVIRONMENT || config.environment || 'sandbox',
      baseUrl: config.baseUrl || (process.env.MC_ENVIRONMENT === 'production'
        ? 'https://api.mastercard.com'
        : 'https://sandbox.api.mastercard.com'),
    };
    this.privateKey = null;
    if (this.config.privateKeyPath) {
      try {
        if (fs.existsSync(this.config.privateKeyPath)) {
          this.privateKey = fs.readFileSync(this.config.privateKeyPath, 'utf8');
        }
      } catch {
        this.privateKey = null;
      }
    }
  }

  isConfigured() {
    return Boolean(this.config.consumerKey && this.privateKey);
  }

  _requireConfigured() {
    if (!this.isConfigured()) {
      throw new Error('MastercardProvider is not configured');
    }
  }

  async createPayment() {
    this._requireConfigured();
    throw new Error('Mastercard A2A createPayment is not implemented; provider disabled until the signed API integration is installed');
  }

  async verifyPayment() {
    this._requireConfigured();
    throw new Error('Mastercard A2A verifyPayment is not implemented; provider disabled until the API integration is installed');
  }

  async verifyWebhook() {
    this._requireConfigured();
    throw new Error('Mastercard A2A webhook verification is not implemented; provider disabled until certificate verification is installed');
  }

  async refund() {
    this._requireConfigured();
    throw new Error('Mastercard A2A refunds are not implemented; provider disabled until the refund API is installed');
  }

  async getAvailableMethods() {
    return [];
  }
}

export default MastercardProvider;
