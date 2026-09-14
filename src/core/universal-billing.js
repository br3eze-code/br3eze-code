/**
 * Backward-compatible Core shim for the billing capability port.
 * Concrete billing implementations live under src/adapters/payments/.
 */
export {
  registerBillingProvider,
  clearBillingProvider,
  getBillingProvider,
  createBilling
} from './ports/billing.js';

import { createBilling } from './ports/billing.js';
export default class UniversalBilling {
  constructor(config = {}) { Object.assign(this, createBilling(config)); }
}
