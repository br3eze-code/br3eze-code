// src/payments/providers/pesapal-provider.js
// PesaPal Integration for Br3eze Africa - AgentOS
// Credentials: Br3eze Africa Production Account

const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');

class PesaPalProvider {
  constructor(config = {}) {
    this.config = {
      // Br3eze Africa Credentials (from your email)
      consumerKey: config.pesapalConsumerKey || process.env.PESAPAL_CONSUMER_KEY,
      consumerSecret: config.pesapalConsumerSecret || process.env.PESAPAL_CONSUMER_SECRET,
      
      // Environment
      environment: config.pesapalEnvironment || process.env.PESAPAL_ENV || 'sandbox',
      
      // IPN Configuration
      ipnUrl: config.pesapalIpnUrl || process.env.PESAPAL_IPN_URL,
      callbackUrl: config.pesapalCallbackUrl || process.env.PESAPAL_CALLBACK_URL,
      
      // IPN ID (obtained after registration)
      ipnId: config.pesapalIpnId || process.env.PESAPAL_IPN_ID,
      
      ...config
    };

    // PesaPal API endpoints
    this.baseUrls = {
      sandbox: 'https://cybqa.pesapal.com/pesapalv3',
      production: 'https://pay.pesapal.com/v3'
    };

    this.baseUrl = this.baseUrls[this.config.environment];
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Authenticate with PesaPal and get access token
   */
  async authenticate() {
    // Return cached token if still valid
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const authString = Buffer.from(`${this.config.consumerKey}:${this.config.consumerSecret}`).toString('base64');

    try {
      const response = await this.makeRequest('/api/Auth/RequestToken', 'POST', null, {
        'Authorization': `Basic ${authString}`,
        'Content-Type': 'application/json'
      });

      if (!response.token) {
        throw new Error('No token received from PesaPal');
      }

      this.accessToken = response.token;
      // Token expires in 5 minutes, refresh after 4 minutes
      this.tokenExpiry = Date.now() + (4 * 60 * 1000);

      console.log('[PesaPal] Authenticated successfully');
      return this.accessToken;
    } catch (error) {
      console.error('[PesaPal] Authentication failed:', error.message);
      throw error;
    }
  }

  /**
   * Register IPN URL (Instant Payment Notification)
   * Call this once to get your IPN ID
   */
  async registerIPN(url, method = 'POST') {
    const token = await this.authenticate();

    const payload = {
      url: url,
      ipn_notification_type: method
    };

    try {
      const response = await this.makeRequest('/api/URLSetup/RegisterIPN', 'POST', payload, {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      });

      console.log('[PesaPal] IPN Registered:', response);
      
      // Store the IPN ID
      if (response.ipn_id) {
        this.config.ipnId = response.ipn_id;
      }

      return response;
    } catch (error) {
      console.error('[PesaPal] IPN Registration failed:', error.message);
      throw error;
    }
  }

  /**
   * Get list of registered IPN URLs
   */
  async getRegisteredIPNs() {
    const token = await this.authenticate();

    return await this.makeRequest('/api/URLSetup/GetIpnList', 'GET', null, {
      'Authorization': `Bearer ${token}`
    });
  }

  /**
   * Submit order/payment request
   * @param {Object} data - Order details
   */
  async createPayment(data) {
    const {
      amount,
      currency = 'USD',
      description,
      reference,
      customerEmail,
      customerPhone,
      customerName = 'Br3eze Customer',
      callbackUrl,
      notificationId
    } = data;

    // Validate required fields
    if (!amount || amount <= 0) {
      throw new Error('Invalid amount');
    }

    const token = await this.authenticate();

    // Ensure we have an IPN ID
    const ipnId = notificationId || this.config.ipnId;
    if (!ipnId) {
      console.warn('[PesaPal] Warning: No IPN ID provided. Register IPN first.');
    }

    const payload = {
      id: reference || `BR3EZE-${Date.now()}`,
      currency: currency,
      amount: parseFloat(amount),
      description: description || 'Br3eze Africa WiFi Voucher',
      callback_url: callbackUrl || this.config.callbackUrl,
      notification_id: ipnId,
      billing_address: {
        email_address: customerEmail || `customer${Date.now()}@br3eze.africa`,
        phone_number: this.formatPhoneNumber(customerPhone),
        country_code: 'ZW',
        first_name: customerName.split(' ')[0] || 'Customer',
        last_name: customerName.split(' ').slice(1).join(' ') || 'User',
        line_1: 'Harare',
        line_2: '',
        city: 'Harare',
        state: 'Harare',
        postal_code: '00263',
        zip_code: '00263'
      }
    };

    try {
      const response = await this.makeRequest('/api/Transactions/SubmitOrderRequest', 'POST', payload, {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      });

      console.log('[PesaPal] Order submitted:', response);

      return {
        success: true,
        orderTrackingId: response.order_tracking_id,
        merchantReference: response.merchant_reference,
        redirectUrl: response.redirect_url,
        status: 'pending',
        amount: amount,
        currency: currency,
        provider: 'pesapal',
        createdAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('[PesaPal] Order submission failed:', error.message);
      throw error;
    }
  }

  /**
   * Get transaction status
   * @param {string} orderTrackingId - PesaPal order tracking ID
   */
  async verifyPayment(orderTrackingId) {
    if (!orderTrackingId) {
      throw new Error('Order tracking ID is required');
    }

    const token = await this.authenticate();

    try {
      const response = await this.makeRequest(
        `/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`,
        'GET',
        null,
        {
          'Authorization': `Bearer ${token}`
        }
      );

      const statusMap = {
        'INVALID': 'failed',
        'FAILED': 'failed',
        'COMPLETED': 'completed',
        'REVERSED': 'refunded',
        'PENDING': 'pending'
      };

      return {
        success: response.status === 'COMPLETED',
        status: statusMap[response.status] || response.status.toLowerCase(),
        orderTrackingId: response.order_tracking_id,
        merchantReference: response.merchant_reference,
        paymentMethod: response.payment_method,
        amount: parseFloat(response.amount),
        currency: response.currency,
        confirmationCode: response.confirmation_code,
        paymentAccount: response.payment_account,
        createdAt: response.created_date,
        paidAt: response.status === 'COMPLETED' ? new Date().toISOString() : null,
        raw: response
      };
    } catch (error) {
      console.error('[PesaPal] Status check failed:', error.message);
      throw error;
    }
  }

  /**
   * Request refund
   */
  async refund(orderTrackingId, amount, reason = 'Customer request') {
    const token = await this.authenticate();

    const payload = {
      order_tracking_id: orderTrackingId,
      amount: amount.toFixed(2),
      reason: reason
    };

    try {
      const response = await this.makeRequest('/api/Transactions/RefundRequest', 'POST', payload, {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      });

      return {
        success: response.status === 'SUCCESS',
        refundId: response.refund_id,
        status: response.status.toLowerCase(),
        amount: parseFloat(response.amount),
        message: response.message
      };
    } catch (error) {
      console.error('[PesaPal] Refund failed:', error.message);
      throw error;
    }
  }

  /**
   * Verify IPN/Webhook payload
   * Based on PesaPal IPN documentation from your screenshot
   */
  async verifyWebhook(payload, headers) {
    // PesaPal sends IPN as POST with order details
    // Verify by checking the order status directly
    const orderTrackingId = payload.OrderTrackingId || 
                           payload.order_tracking_id || 
                           payload.id;

    if (!orderTrackingId) {
      console.error('[PesaPal IPN] No order tracking ID found in payload');
      return false;
    }

    try {
      // Verify by fetching actual status from API
      const status = await this.verifyPayment(orderTrackingId);
      return status.orderTrackingId === orderTrackingId;
    } catch (error) {
      console.error('[PesaPal IPN] Verification failed:', error.message);
      return false;
    }
  }

  /**
   * Process IPN/Webhook payload
   * Based on your documentation screenshot
   */
  async processWebhook(payload) {
    // PesaPal IPN payload structure (from your screenshot):
    // {
    //   "id": 10463,
    //   "first_name": "joe",
    //   "last_name": "doe",
    //   "phone": "+254712345678",
    //   "amount": 1.0,
    //   "payment_option": "Visa",
    //   "transaction_date": "2022-02-04T14:19:05.0210431Z",
    //   "currency": "KES",
    //   "merchant_reference": "TEST",
    //   "confirmation_code": "test10"
    // }

    const status = payload.status || 'PENDING';
    
    const statusMap = {
      'COMPLETED': 'payment_success',
      'FAILED': 'payment_failed',
      'REVERSED': 'payment_reversed',
      'PENDING': 'payment_pending'
    };

    return {
      type: statusMap[status] || 'payment_update',
      orderTrackingId: payload.OrderTrackingId || payload.order_tracking_id,
      merchantReference: payload.merchant_reference || payload.MerchantReference,
      paymentMethod: payload.payment_option || payload.PaymentOption,
      amount: parseFloat(payload.amount || payload.Amount),
      currency: payload.currency || payload.Currency,
      confirmationCode: payload.confirmation_code || payload.ConfirmationCode,
      customerPhone: payload.phone || payload.Phone,
      customerName: `${payload.first_name || ''} ${payload.last_name || ''}`.trim(),
      transactionDate: payload.transaction_date || payload.TransactionDate,
      status: status.toLowerCase(),
      raw: payload
    };
  }

  /**
   * Format phone number for Zimbabwe
   */
  formatPhoneNumber(phone) {
    if (!phone) return '';
    
    let cleaned = phone.replace(/\D/g, '');
    
    // Convert local format to international
    if (cleaned.startsWith('0')) {
      cleaned = '263' + cleaned.substring(1);
    }
    
    if (!cleaned.startsWith('263')) {
      cleaned = '263' + cleaned;
    }
    
    return '+' + cleaned;
  }

  /**
   * Make HTTP request to PesaPal API
   */
  makeRequest(endpoint, method, body = null, customHeaders = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + endpoint);
      
      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: method,
        headers: {
          'Accept': 'application/json',
          ...customHeaders
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            
            if (res.statusCode >= 400) {
              const errorMsg = parsed.error?.message || 
                              parsed.message || 
                              `HTTP ${res.statusCode}: ${data}`;
              reject(new Error(errorMsg));
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(new Error(`Invalid JSON response: ${data}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Request failed: ${err.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      // 30 second timeout
      req.setTimeout(30000);

      if (body && method !== 'GET') {
        req.write(JSON.stringify(body));
      }
      
      req.end();
    });
  }
}

module.exports = PesaPalProvider;
