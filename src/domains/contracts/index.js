import BaseDomain from '../BaseDomain.js';

/**
 * Contract domain boundary. Lifecycle decisions live in the contract domain;
 * persistence, rendering, signing, and external providers remain adapters.
 */
export class ContractsDomain extends BaseDomain {
  constructor() {
    super();
    this.name = 'contracts';
    this.description = 'Tenant-scoped contract lifecycle and evidence';
    this.capabilities = [
      'contracts.read',
      'contracts.create',
      'contracts.transition',
      'contracts.evidence.read',
    ];
  }
}

export default ContractsDomain;
