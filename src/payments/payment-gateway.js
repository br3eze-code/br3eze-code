import { createPaymentPlatform } from './payment-platform.js';

export class PaymentGateway {
  constructor(config = {}) { this.platform = createPaymentPlatform(config); }
  getAvailableMethods(options = {}) { return this.platform.getAvailablePaymentMethods(options); }
}

export default PaymentGateway;
