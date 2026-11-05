import BaseDomain from '../BaseDomain.js';

/**
 * Provider-neutral procurement domain boundary.
 * Supplier provisioning and outbound supplier calls remain owned by their
 * dedicated services/adapters; this domain only advertises that capability.
 */
export class ProcurementDomain extends BaseDomain {
  constructor() {
    super();
    this.name = 'procurement';
    this.description = 'Supplier provisioning and procurement workflows';
    this.capabilities = [
      'procurement.suppliers.read',
      'procurement.orders.create',
      'procurement.orders.reconcile',
    ];
  }
}

export default ProcurementDomain;
