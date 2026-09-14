let provider = null;
export function registerBillingProvider(implementation) {
  if (typeof implementation !== 'function' && typeof implementation?.create === 'function') provider = implementation;
  else if (typeof implementation === 'function') provider = implementation;
  else throw new TypeError('Billing provider must be a constructor or factory');
  return provider;
}
export function getBillingProvider() { if (!provider) throw new Error('No billing provider registered'); return provider; }
export function createBilling(config = {}) { const Provider = getBillingProvider(); return typeof Provider.create === 'function' ? Provider.create(config) : new Provider(config); }
export default class UniversalBilling {
  constructor(config = {}) { Object.assign(this, createBilling(config)); }
}
