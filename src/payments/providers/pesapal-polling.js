// src/payments/providers/pesapal-polling.js

class PesaPalPolling {
  constructor(provider) {
    this.provider = provider;
    this.pollingIntervals = new Map();
  }

  async createPaymentAndPoll(data, onSuccess, onFailure) {
    const payment = await this.provider.createPayment({
      ...data,
      notificationId: null // No IPN
    });

    // Start polling
    this.startPolling(payment.orderTrackingId, onSuccess, onFailure);
    
    return payment;
  }

  startPolling(orderTrackingId, onSuccess, onFailure, maxAttempts = 60) {
    let attempts = 0;
    
    const interval = setInterval(async () => {
      attempts++;
      
      try {
        const status = await this.provider.verifyPayment(orderTrackingId);
        
        if (status.success) {
          clearInterval(interval);
          this.pollingIntervals.delete(orderTrackingId);
          await onSuccess(status);
        } else if (status.status === 'failed' || attempts >= maxAttempts) {
          clearInterval(interval);
          this.pollingIntervals.delete(orderTrackingId);
          await onFailure(status);
        }
        // Continue polling if pending
        
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 10000); // Check every 10 seconds

    this.pollingIntervals.set(orderTrackingId, interval);
  }

  stopPolling(orderTrackingId) {
    const interval = this.pollingIntervals.get(orderTrackingId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(orderTrackingId);
    }
  }
}

module.exports = PesaPalPolling;
