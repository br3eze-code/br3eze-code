// src/payments/pesapal-integration.js
// Complete PesaPal integration for Br3eze Africa AgentOS

const PesaPalProvider = require('./providers/pesapal-provider');

class PesaPalIntegration {
  constructor(config = {}) {
    this.provider = new PesaPalProvider(config);
    this.db = null;
    this.telegramBot = null;
  }

  setDatabase(db) {
    this.db = db;
  }

  setTelegramBot(bot) {
    this.telegramBot = bot;
  }

  /**
   * Initialize PesaPal - register IPN if needed
   */
  async initialize(ipnUrl) {
    try {
      // Check if we have IPN registered
      const ipns = await this.provider.getRegisteredIPNs();
      console.log('[PesaPal] Registered IPNs:', ipns);

      // If no IPN ID set, register one
      if (!this.provider.config.ipnId && ipnUrl) {
        const result = await this.provider.registerIPN(ipnUrl, 'POST');
        console.log('[PesaPal] New IPN registered:', result);
        
        // Save to config
        this.provider.config.ipnId = result.ipn_id;
      }

      return true;
    } catch (error) {
      console.error('[PesaPal] Initialization failed:', error);
      return false;
    }
  }

  /**
   * Create a voucher purchase
   */
  async createVoucherPurchase(userId, voucherType, amount, customerInfo = {}) {
    const reference = `BR3EZE-${userId}-${Date.now()}`;
    
    try {
      const payment = await this.provider.createPayment({
        amount: amount,
        currency: 'USD',
        description: `Br3eze WiFi Voucher - ${voucherType}`,
        reference: reference,
        customerEmail: customerInfo.email || `user${userId}@br3eze.africa`,
        customerPhone: customerInfo.phone || '',
        customerName: customerInfo.name || 'Br3eze Customer',
        notificationId: this.provider.config.ipnId
      });

      // Store pending transaction
      if (this.db) {
        await this.db.collection('transactions').doc(payment.orderTrackingId).set({
          userId: userId.toString(),
          voucherType: voucherType,
          amount: amount,
          currency: 'USD',
          status: 'pending',
          merchantReference: reference,
          orderTrackingId: payment.orderTrackingId,
          provider: 'pesapal',
          createdAt: new Date(),
          customerInfo: customerInfo
        });
      }

      return {
        success: true,
        ...payment,
        reference: reference
      };
    } catch (error) {
      console.error('[PesaPal] Voucher purchase creation failed:', error);
      throw error;
    }
  }

  /**
   * Handle successful payment (called from IPN)
   */
  async handleSuccessfulPayment(ipnData) {
    const { orderTrackingId, merchantReference, amount, paymentMethod, confirmationCode } = ipnData;

    try {
      // Update transaction
      if (this.db) {
        await this.db.collection('transactions').doc(orderTrackingId).update({
          status: 'completed',
          paymentMethod: paymentMethod,
          confirmationCode: confirmationCode,
          paidAt: new Date(),
          ipnData: ipnData
        });

        // Get transaction details
        const txDoc = await this.db.collection('transactions').doc(orderTrackingId).get();
        const tx = txDoc.data();

        // Generate voucher code
        const voucherCode = this.generateVoucherCode();
        const expiryDate = this.calculateExpiry(tx.voucherType);

        // Save voucher
        await this.db.collection('vouchers').doc(voucherCode).set({
          code: voucherCode,
          type: tx.voucherType,
          amount: amount,
          currency: 'USD',
          transactionId: orderTrackingId,
          userId: tx.userId,
          createdAt: new Date(),
          expiresAt: expiryDate,
          used: false,
          status: 'active'
        });

        // Send to user via Telegram
        if (this.telegramBot) {
          await this.telegramBot.sendMessage(tx.userId, 
            `✅ *Payment Successful!*\n\n` +
            `🎫 *Your WiFi Voucher Code:*\n` +
            `\`${voucherCode}\`\n\n` +
            `📊 *Details:*\n` +
            `• Type: ${tx.voucherType}\n` +
            `• Amount: $${amount}\n` +
            `• Payment: ${paymentMethod}\n` +
            `• Confirmation: ${confirmationCode}\n` +
            `• Valid until: ${expiryDate.toLocaleString()}\n\n` +
            `Connect to Br3eze WiFi and enter this code!`,
            { parse_mode: 'Markdown' }
          );
        }

        return {
          success: true,
          voucherCode: voucherCode,
          orderTrackingId: orderTrackingId
        };
      }
    } catch (error) {
      console.error('[PesaPal] Handle payment success failed:', error);
      throw error;
    }
  }

  /**
   * Generate random voucher code
   */
  generateVoucherCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `${code.substr(0, 4)}-${code.substr(4, 4)}`;
  }

  /**
   * Calculate voucher expiry
   */
  calculateExpiry(type) {
    const now = new Date();
    const hours = {
      '1Hour': 1,
      '1Day': 24,
      '1Week': 24 * 7,
      '1Month': 24 * 30
    }[type] || 24;
    
    return new Date(now.getTime() + hours * 60 * 60 * 1000);
  }

  /**
   * Get transaction status
   */
  async getTransactionStatus(orderTrackingId) {
    return await this.provider.verifyPayment(orderTrackingId);
  }

  /**
   * Process refund
   */
  async processRefund(orderTrackingId, amount, reason) {
    return await this.provider.refund(orderTrackingId, amount, reason);
  }
}

module.exports = PesaPalIntegration;
