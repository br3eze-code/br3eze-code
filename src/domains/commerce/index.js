import BaseDomain from '../BaseDomain.js';

/**
 * Commerce domain boundary. Payment verification and settlement remain in the
 * dedicated provider-neutral webhook/reconciliation modules; this adapter
 * exposes their domain identity without embedding a payment provider.
 */
export class CommerceDomain extends BaseDomain {
  constructor() {
    super();
    this.name = 'commerce';
    this.description = 'Provider-neutral commerce, orders, invoices, and payment reconciliation';
    this.capabilities = [
      'commerce.orders.read',
      'commerce.invoices.read',
      'commerce.payments.reconcile',
    ];
  }
}

export default CommerceDomain;
