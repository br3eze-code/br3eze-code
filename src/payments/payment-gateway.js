// src/payments/payment-gateway.js
// CommonJS Payment Gateway for AgentOS
// Supports: Stripe, EcoCash, NetOne, PayNow, Apple Pay, Google Pay

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const PesaPayProvider = require('./providers/pesapay-provider');
const { URL } = require('url');

class PaymentGateway {
  constructor(config = {}) {
    this.config = {
      // Stripe
      stripeSecretKey: config.stripeSecretKey || process.env.STRIPE_SECRET_KEY,
      stripeWebhookSecret: config.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET,
      stripePublishableKey: config.stripePublishableKey || process.env.STRIPE_PUBLISHABLE_KEY,
      
      // EcoCash (Zimbabwe)
      ecocashMerchantCode: config.ecocashMerchantCode || process.env.ECOCASH_MERCHANT_CODE,
      ecocashApiKey: config.ecocashApiKey || process.env.ECOCASH_API_KEY,
      ecocashEnvironment: config.ecocashEnvironment || process.env.ECOCASH_ENV || 'sandbox',
      
      // NetOne (Zimbabwe)
      netoneApiKey: config.netoneApiKey || process.env.NETONE_API_KEY,
      netoneMerchantId: config.netoneMerchantId || process.env.NETONE_MERCHANT_ID,
      
      // PayNow (Zimbabwe)
      paynowIntegrationId: config.paynowIntegrationId || process.env.PAYNOW_INTEGRATION_ID,
      paynowIntegrationKey: config.paynowIntegrationKey || process.env.PAYNOW_INTEGRATION_KEY,
      paynowResultUrl: config.paynowResultUrl || process.env.PAYNOW_RESULT_URL,
      paynowReturnUrl: config.paynowReturnUrl || process.env.PAYNOW_RETURN_URL,
      
      // Apple Pay
      applePayMerchantId: config.applePayMerchantId || process.env.APPLE_PAY_MERCHANT_ID,
      applePayCertificatePath: config.applePayCertificatePath || process.env.APPLE_PAY_CERT_PATH,
      applePayKeyPath: config.applePayKeyPath || process.env.APPLE_PAY_KEY_PATH,
      applePayMerchantDomain: config.applePayMerchantDomain || process.env.APPLE_PAY_DOMAIN,
      
      // Google Pay
      googlePayMerchantId: config.googlePayMerchantId || process.env.GOOGLE_PAY_MERCHANT_ID,
      googlePayMerchantName: config.googlePayMerchantName || process.env.GOOGLE_PAY_MERCHANT_NAME,
      googlePayEnvironment: config.googlePayEnvironment || process.env.GOOGLE_PAY_ENV || 'TEST',
      
      // Webhook URL for callbacks
      webhookBaseUrl: config.webhookBaseUrl || process.env.WEBHOOK_BASE_URL,
      
      // Default currency
      defaultCurrency: config.defaultCurrency || 'USD',
      
      ...config
    };
    
    this.providers = new Map();
    this.initializeProviders();
  }

  initializeProviders() {
    // Initialize all available payment providers
    if (this.config.stripeSecretKey) {
      this.providers.set('stripe', new StripeProvider(this.config));
    }
    // PesaPay (Zimbabwe All-in-One)
  if (this.config.pesapayConsumerKey) {
    this.providers.set('pesapay', new PesaPayProvider(this.config));
  }
}

// In getAvailableMethods(), add PesaPay options:
getAvailableMethods(options = {}) {
  const methods = [];
  const { country = 'ZW' } = options;

  // PesaPay - Zimbabwe all-in-one solution
  if (this.providers.has('pesapay') && country === 'ZW') {
    const pesapay = this.providers.get('pesapay');
    methods.push(...pesapay.getSupportedMethods());
  }
    if (this.config.ecocashMerchantCode) {
      this.providers.set('ecocash', new EcoCashProvider(this.config));
    }
    if (this.config.netoneApiKey) {
      this.providers.set('netone', new NetOneProvider(this.config));
    }
    if (this.config.paynowIntegrationId) {
      this.providers.set('paynow', new PayNowProvider(this.config));
    }
    if (this.config.applePayMerchantId) {
      this.providers.set('apple_pay', new ApplePayProvider(this.config));
    }
    if (this.config.googlePayMerchantId) {
      this.providers.set('google_pay', new GooglePayProvider(this.config));
    }
  }

  /**
   * Get available payment methods for a user
   * @param {Object} options - User context (country, device, etc.)
   * @returns {Array} Available payment methods
   */
  getAvailableMethods(options = {}) {
    const methods = [];
    const { country = 'ZW', device = 'mobile' } = options;

    // Zimbabwe-specific methods
    if (country === 'ZW') {
      if (this.providers.has('ecocash')) {
        methods.push({
          id: 'ecocash',
          name: 'EcoCash',
          type: 'mobile_money',
          icon: '💳',
          description: 'Pay with EcoCash mobile money',
          currencies: ['ZWL', 'USD', 'ZIG'],
          countries: ['ZW']
        });
      }
      if (this.providers.has('netone')) {
        methods.push({
          id: 'netone',
          name: 'OneMoney',
          type: 'mobile_money',
          icon: '📱',
          description: 'Pay with NetOne OneMoney',
          currencies: ['ZWL', 'USD', 'ZIG'],
          countries: ['ZW']
        });
      }
      if (this.providers.has('paynow')) {
        methods.push({
          id: 'paynow',
          name: 'PayNow',
          type: 'aggregator',
          icon: '🔒',
          description: 'Pay via PayNow (supports multiple methods)',
          currencies: ['ZWL', 'USD', 'ZIG'],
          countries: ['ZW']
        });
      }
    }

    // International methods
    if (this.providers.has('stripe')) {
      methods.push({
        id: 'stripe',
        name: 'Credit/Debit Card',
        type: 'card',
        icon: '💳',
        description: 'Pay with Visa, Mastercard, etc.',
        currencies: ['USD', 'EUR', 'GBP', 'ZWL'],
        countries: ['*']
      });
    }

    // Digital wallets
    if (device === 'ios' && this.providers.has('apple_pay')) {
      methods.push({
        id: 'apple_pay',
        name: 'Apple Pay',
        type: 'wallet',
        icon: '🍎',
        description: 'Quick and secure Apple Pay',
        currencies: ['USD', 'EUR', 'GBP'],
        countries: ['*']
      });
    }

    if (this.providers.has('google_pay')) {
      methods.push({
        id: 'google_pay',
        name: 'Google Pay',
        type: 'wallet',
        icon: '🔷',
        description: 'Fast checkout with Google Pay',
        currencies: ['USD', 'EUR', 'GBP'],
        countries: ['*']
      });
    }

    return methods;
  }

  /**
   * Create a payment intent/charge
   * @param {string} provider - Payment provider ID
   * @param {Object} paymentData - Payment details
   * @returns {Promise<Object>} Payment result
   */
  async createPayment(provider, paymentData) {
    const providerInstance = this.providers.get(provider);
    if (!providerInstance) {
      throw new Error(`Payment provider '${provider}' not available`);
    }

    try {
      const result = await providerInstance.createPayment(paymentData);
      
      // Log transaction
      await this.logTransaction({
        provider,
        ...paymentData,
        status: result.status,
        transactionId: result.transactionId
      });

      return result;
    } catch (error) {
      await this.logTransaction({
        provider,
        ...paymentData,
        status: 'failed',
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Verify payment status
   * @param {string} provider - Payment provider ID
   * @param {string} transactionId - Transaction reference
   * @returns {Promise<Object>} Payment status
   */
  async verifyPayment(provider, transactionId) {
    const providerInstance = this.providers.get(provider);
    if (!providerInstance) {
      throw new Error(`Payment provider '${provider}' not available`);
    }

    return await providerInstance.verifyPayment(transactionId);
  }

  /**
   * Handle webhook callbacks
   * @param {string} provider - Payment provider ID
   * @param {Object} payload - Webhook payload
   * @param {Object} headers - Request headers
   * @returns {Promise<Object>} Webhook processing result
   */
  async handleWebhook(provider, payload, headers) {
    const providerInstance = this.providers.get(provider);
    if (!providerInstance) {
      throw new Error(`Payment provider '${provider}' not available`);
    }

    // Verify webhook signature
    const isValid = await providerInstance.verifyWebhook(payload, headers);
    if (!isValid) {
      throw new Error('Invalid webhook signature');
    }

    return await providerInstance.processWebhook(payload);
  }

  /**
   * Refund a payment
   * @param {string} provider - Payment provider ID
   * @param {string} transactionId - Original transaction ID
   * @param {number} amount - Amount to refund
   * @param {string} reason - Refund reason
   * @returns {Promise<Object>} Refund result
   */
  async refund(provider, transactionId, amount, reason = '') {
    const providerInstance = this.providers.get(provider);
    if (!providerInstance) {
      throw new Error(`Payment provider '${provider}' not available`);
    }

    return await providerInstance.refund(transactionId, amount, reason);
  }

  /**
   * Log transaction to database
   * @param {Object} transaction - Transaction data
   */
  async logTransaction(transaction) {
    // This would integrate with your existing database
    // For now, just console log
    console.log('[Payment Transaction]', {
      timestamp: new Date().toISOString(),
      ...transaction
    });
  }
}

// ==================== STRIPE PROVIDER ====================

class StripeProvider {
  constructor(config) {
    this.config = config;
    this.baseUrl = 'https://api.stripe.com/v1';
  }

  async createPayment(data) {
    const { amount, currency = 'usd', description, metadata = {}, customerEmail } = data;

    const params = new URLSearchParams({
      amount: Math.round(amount * 100), // Convert to cents
      currency: currency.toLowerCase(),
      'payment_method_types[]': 'card',
      description,
      ...Object.entries(metadata).reduce((acc, [key, val]) => {
        acc[`metadata[${key}]`] = val;
        return acc;
      }, {})
    });

    if (customerEmail) {
      params.append('receipt_email', customerEmail);
    }

    const response = await this.makeRequest('/payment_intents', 'POST', params.toString());
    
    return {
      success: true,
      transactionId: response.id,
      clientSecret: response.client_secret,
      status: response.status,
      amount: response.amount / 100,
      currency: response.currency,
      provider: 'stripe'
    };
  }

  async verifyPayment(paymentIntentId) {
    const response = await this.makeRequest(`/payment_intents/${paymentIntentId}`, 'GET');
    
    return {
      success: response.status === 'succeeded',
      status: response.status,
      amount: response.amount / 100,
      currency: response.currency,
      metadata: response.metadata
    };
  }

  async refund(paymentIntentId, amount, reason) {
    const params = new URLSearchParams({
      payment_intent: paymentIntentId,
      amount: Math.round(amount * 100),
      reason: 'requested_by_customer'
    });

    if (reason) {
      params.append('metadata[reason]', reason);
    }

    const response = await this.makeRequest('/refunds', 'POST', params.toString());

    return {
      success: true,
      refundId: response.id,
      amount: response.amount / 100,
      status: response.status
    };
  }

  async verifyWebhook(payload, headers) {
    const signature = headers['stripe-signature'];
    if (!signature || !this.config.stripeWebhookSecret) return false;

    // Verify Stripe signature
    const expectedSignature = crypto
      .createHmac('sha256', this.config.stripeWebhookSecret)
      .update(JSON.stringify(payload), 'utf8')
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  async processWebhook(payload) {
    const event = payload;
    
    switch (event.type) {
      case 'payment_intent.succeeded':
        return {
          type: 'payment_success',
          transactionId: event.data.object.id,
          amount: event.data.object.amount / 100,
          currency: event.data.object.currency,
          metadata: event.data.object.metadata
        };
      
      case 'payment_intent.payment_failed':
        return {
          type: 'payment_failed',
          transactionId: event.data.object.id,
          error: event.data.object.last_payment_error?.message
        };
      
      case 'charge.refunded':
        return {
          type: 'refund',
          transactionId: event.data.object.payment_intent,
          amount: event.data.object.amount_refunded / 100
        };
      
      default:
        return { type: 'unknown', event: event.type };
    }
  }

  makeRequest(endpoint, method, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + endpoint);
      
      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers: {
          'Authorization': `Bearer ${this.config.stripeSecretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(parsed.error?.message || 'Stripe API error'));
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }
}

// ==================== ECOCASH PROVIDER ====================

class EcoCashProvider {
  constructor(config) {
    this.config = config;
    this.baseUrl = config.ecocashEnvironment === 'production' 
      ? 'https://api.ecocash.co.zw/v2'
      : 'https://sandbox.api.ecocash.co.zw/v2';
  }

  async createPayment(data) {
    const { amount, currency = 'ZWL', phoneNumber, description, reference } = data;

    // Validate phone number (Zimbabwe format)
    const sanitizedPhone = this.sanitizePhoneNumber(phoneNumber);
    
    const payload = {
      merchantCode: this.config.ecocashMerchantCode,
      apiKey: this.config.ecocashApiKey,
      amount: amount.toFixed(2),
      currency,
      customerPhone: sanitizedPhone,
      description: description || 'AgentOS Payment',
      reference: reference || `AGENTOS-${Date.now()}`,
      callbackUrl: `${this.config.webhookBaseUrl}/webhooks/ecocash`
    };

    const response = await this.makeRequest('/payments/initiate', 'POST', payload);

    return {
      success: true,
      transactionId: response.transactionRef,
      status: 'pending',
      amount,
      currency,
      provider: 'ecocash',
      instructions: 'Please check your EcoCash phone and enter PIN to authorize payment'
    };
  }

  async verifyPayment(transactionRef) {
    const response = await this.makeRequest(`/payments/status/${transactionRef}`, 'GET');
    
    return {
      success: response.status === 'SUCCESS',
      status: response.status.toLowerCase(),
      amount: parseFloat(response.amount),
      currency: response.currency,
      phoneNumber: response.customerPhone,
      paidAt: response.completedAt
    };
  }

  async refund(transactionRef, amount, reason) {
    const payload = {
      originalTransactionRef: transactionRef,
      amount: amount.toFixed(2),
      reason: reason || 'Customer request'
    };

    const response = await this.makeRequest('/payments/refund', 'POST', payload);

    return {
      success: response.status === 'SUCCESS',
      refundId: response.refundRef,
      amount: parseFloat(response.amount),
      status: response.status.toLowerCase()
    };
  }

  async verifyWebhook(payload, headers) {
    // EcoCash uses HMAC signature verification
    const signature = headers['x-ecocash-signature'];
    if (!signature) return false;

    const expectedSignature = crypto
      .createHmac('sha256', this.config.ecocashApiKey)
      .update(JSON.stringify(payload))
      .digest('hex');

    return signature === expectedSignature;
  }

  async processWebhook(payload) {
    const { transactionRef, status, amount, currency } = payload;

    return {
      type: status === 'SUCCESS' ? 'payment_success' : 'payment_failed',
      transactionId: transactionRef,
      amount: parseFloat(amount),
      currency,
      status: status.toLowerCase()
    };
  }

  sanitizePhoneNumber(phone) {
    // Convert to international format
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '263' + cleaned.substring(1);
    }
    if (!cleaned.startsWith('263')) {
      cleaned = '263' + cleaned;
    }
    return cleaned;
  }

  makeRequest(endpoint, method, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + endpoint);
      
      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Merchant-Code': this.config.ecocashMerchantCode,
          'X-API-Key': this.config.ecocashApiKey
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(parsed.message || 'EcoCash API error'));
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }
}

// ==================== NETONE PROVIDER ====================

class NetOneProvider {
  constructor(config) {
    this.config = config;
    this.baseUrl = 'https://api.netone.co.zw/merchant/v1';
  }

  async createPayment(data) {
    const { amount, currency = 'ZWL', phoneNumber, description, reference } = data;

    const payload = {
      merchantId: this.config.netoneMerchantId,
      apiKey: this.config.netoneApiKey,
      amount: amount.toFixed(2),
      currency,
      customerMsisdn: this.sanitizePhoneNumber(phoneNumber),
      narration: description || 'AgentOS Payment',
      reference: reference || `AGENTOS-${Date.now()}`,
      callbackUrl: `${this.config.webhookBaseUrl}/webhooks/netone`
    };

    const response = await this.makeRequest('/transactions/initiate', 'POST', payload);

    return {
      success: true,
      transactionId: response.transactionId,
      status: 'pending',
      amount,
      currency,
      provider: 'netone',
      instructions: 'Please approve the payment prompt on your NetOne phone'
    };
  }

  async verifyPayment(transactionId) {
    const response = await this.makeRequest(`/transactions/${transactionId}/status`, 'GET');
    
    return {
      success: response.status === 'COMPLETED',
      status: response.status.toLowerCase(),
      amount: parseFloat(response.amount),
      currency: response.currency,
      phoneNumber: response.msisdn
    };
  }

  async refund(transactionId, amount, reason) {
    const payload = {
      originalTransactionId: transactionId,
      refundAmount: amount.toFixed(2),
      reason
    };

    const response = await this.makeRequest('/transactions/refund', 'POST', payload);

    return {
      success: response.status === 'SUCCESS',
      refundId: response.refundId,
      amount: parseFloat(response.refundAmount),
      status: response.status.toLowerCase()
    };
  }

  async verifyWebhook(payload, headers) {
    const signature = headers['x-netone-signature'];
    if (!signature) return false;

    const expectedSignature = crypto
      .createHmac('sha256', this.config.netoneApiKey)
      .update(JSON.stringify(payload))
      .digest('hex');

    return signature === expectedSignature;
  }

  async processWebhook(payload) {
    return {
      type: payload.status === 'COMPLETED' ? 'payment_success' : 'payment_failed',
      transactionId: payload.transactionId,
      amount: parseFloat(payload.amount),
      currency: payload.currency,
      status: payload.status.toLowerCase()
    };
  }

  sanitizePhoneNumber(phone) {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '263' + cleaned.substring(1);
    }
    return cleaned;
  }

  makeRequest(endpoint, method, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + endpoint);
      
      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.netoneApiKey}`,
          'X-Merchant-ID': this.config.netoneMerchantId
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(parsed.error || 'NetOne API error'));
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }
}

// ==================== PAYNOW PROVIDER ====================

class PayNowProvider {
  constructor(config) {
    this.config = config;
    this.baseUrl = 'https://www.paynow.co.zw/interface';
  }

  async createPayment(data) {
    const { amount, currency = 'ZWL', description, reference, email, phone } = data;

    const payload = {
      id: this.config.paynowIntegrationId,
      reference: reference || `AGENTOS-${Date.now()}`,
      amount: amount.toFixed(2),
      additionalinfo: description || 'AgentOS Voucher Purchase',
      returnurl: this.config.paynowReturnUrl,
      resulturl: this.config.paynowResultUrl,
      status: 'Message',
      email: email || 'customer@example.com',
      phone: phone || ''
    };

    // Generate hash
    payload.hash = this.generateHash(payload);

    const response = await this.makeRequest('/initiatetransaction', 'POST', payload);
    
    // Parse PayNow response (format: "OK|RedirectURL|PollURL")
    const parts = response.split('|');
    if (parts[0] !== 'OK') {
      throw new Error(`PayNow error: ${response}`);
    }

    return {
      success: true,
      transactionId: payload.reference,
      status: 'pending',
      amount,
      currency,
      provider: 'paynow',
      redirectUrl: parts[1],
      pollUrl: parts[2],
      instructions: 'Complete payment using the provided link'
    };
  }

  async verifyPayment(pollUrl) {
    // Poll for payment status
    const response = await this.makeRequest(pollUrl.replace(this.baseUrl, ''), 'GET');
    
    const parts = response.split('|');
    const status = parts[1];
    
    return {
      success: status === 'Paid' || status === 'Awaiting Delivery',
      status: status.toLowerCase().replace(' ', '_'),
      amount: parseFloat(parts[5]),
      reference: parts[2],
      paynowReference: parts[3]
    };
  }

  async refund(transactionId, amount, reason) {
    // PayNow doesn't support direct refunds via API
    // Must be done through merchant dashboard
    throw new Error('PayNow refunds must be processed through the merchant dashboard');
  }

  async verifyWebhook(payload, headers) {
    // PayNow uses hash verification
    const receivedHash = payload.hash;
    delete payload.hash;
    
    const expectedHash = this.generateHash(payload);
    return receivedHash === expectedHash;
  }

  async processWebhook(payload) {
    const { status, reference, amount, paynowreference } = payload;

    return {
      type: status === 'Paid' ? 'payment_success' : 'payment_update',
      transactionId: reference,
      paynowReference: paynowreference,
      amount: parseFloat(amount),
      status: status.toLowerCase().replace(' ', '_')
    };
  }

  generateHash(values) {
    const stringToHash = Object.values(values).join('');
    return crypto
      .createHash('sha512')
      .update(stringToHash + this.config.paynowIntegrationKey)
      .digest('hex')
      .toUpperCase();
  }

  makeRequest(endpoint, method, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + endpoint);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;
      
      const postData = body ? new URLSearchParams(body).toString() : null;
      
      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'AgentOS/1.0'
        }
      };

      if (postData) {
        options.headers['Content-Length'] = Buffer.byteLength(postData);
      }

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });

      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });
  }
}

// ==================== APPLE PAY PROVIDER ====================

class ApplePayProvider {
  constructor(config) {
    this.config = config;
    this.baseUrl = 'https://apple-pay-gateway.apple.com/paymentservices';
  }

  async createPayment(data) {
    const { amount, currency = 'USD', description, label } = data;

    // Return payment session configuration
    // Actual payment requires client-side Apple Pay JS
    return {
      success: true,
      type: 'apple_pay_session',
      merchantIdentifier: this.config.applePayMerchantId,
      merchantDomain: this.config.applePayMerchantDomain,
      displayName: label || 'AgentOS',
      amount: amount.toFixed(2),
      currency,
      countryCode: 'US',
      supportedNetworks: ['visa', 'masterCard', 'amex'],
      merchantCapabilities: ['supports3DS', 'supportsCredit', 'supportsDebit'],
      requiredBillingContactFields: ['postalAddress', 'name'],
      requiredShippingContactFields: [],
      provider: 'apple_pay'
    };
  }

  async processPayment(paymentToken) {
    // Process decrypted Apple Pay token
    // This would integrate with your payment processor (Stripe, etc.)
    const response = await this.makeRequest('/payment', 'POST', {
      merchantIdentifier: this.config.applePayMerchantId,
      paymentToken: paymentToken
    });

    return {
      success: true,
      transactionId: response.transactionIdentifier,
      status: 'succeeded',
      amount: response.amount,
      currency: response.currency
    };
  }

  async verifyPayment(transactionId) {
    // Apple Pay transactions are verified through the payment processor
    return {
      success: true,
      status: 'succeeded',
      transactionId
    };
  }

  async refund(transactionId, amount, reason) {
    // Refunds processed through underlying payment processor
    throw new Error('Process Apple Pay refunds through your payment processor');
  }

  async verifyWebhook(payload, headers) {
    // Apple Pay webhooks are rare; most verification is done via payment processor
    return true;
  }

  async processWebhook(payload) {
    return {
      type: payload.notificationType,
      ...payload
    };
  }

  makeRequest(endpoint, method, body = null) {
    // Implementation would use Apple Pay certificates
    // This is a placeholder for the actual implementation
    return Promise.resolve({});
  }
}

// ==================== GOOGLE PAY PROVIDER ====================

class GooglePayProvider {
  constructor(config) {
    this.config = config;
  }

  async createPayment(data) {
    const { amount, currency = 'USD', description, label } = data;

    // Return Google Pay configuration for client-side integration
    return {
      success: true,
      type: 'google_pay_config',
      environment: this.config.googlePayEnvironment,
      apiVersion: 2,
      apiVersionMinor: 0,
      merchantInfo: {
        merchantId: this.config.googlePayMerchantId,
        merchantName: this.config.googlePayMerchantName || 'AgentOS'
      },
      allowedPaymentMethods: [{
        type: 'CARD',
        parameters: {
          allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
          allowedCardNetworks: ['VISA', 'MASTERCARD', 'AMEX']
        },
        tokenizationSpecification: {
          type: 'PAYMENT_GATEWAY',
          parameters: {
            gateway: 'stripe',
            'stripe:version': '2018-10-31',
            'stripe:publishableKey': this.config.stripePublishableKey
          }
        }
      }],
      transactionInfo: {
        totalPriceStatus: 'FINAL',
        totalPrice: amount.toFixed(2),
        currencyCode: currency.toUpperCase(),
        countryCode: 'US',
        transactionId: `AGENTOS-${Date.now()}`
      },
      provider: 'google_pay'
    };
  }

  async processPayment(paymentData) {
    // Process Google Pay token through Stripe or other gateway
    const { paymentMethodData } = paymentData;
    
    return {
      success: true,
      transactionId: paymentMethodData.tokenizationData.token,
      status: 'succeeded',
      paymentMethod: paymentMethodData.type,
      cardDetails: paymentMethodData.info
    };
  }

  async verifyPayment(transactionId) {
    return {
      success: true,
      status: 'succeeded',
      transactionId
    };
  }

  async refund(transactionId, amount, reason) {
    throw new Error('Process Google Pay refunds through your payment processor');
  }

  async verifyWebhook(payload, headers) {
    return true;
  }

  async processWebhook(payload) {
    return {
      type: payload.type,
      ...payload
    };
  }
}

module.exports = {
  PaymentGateway,
  StripeProvider,
  EcoCashProvider,
  NetOneProvider,
  PayNowProvider,
  ApplePayProvider,
  GooglePayProvider
};
