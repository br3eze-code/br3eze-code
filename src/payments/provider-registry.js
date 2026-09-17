import { assertProviderAllowed } from './payment-provider-policy.js';

export class PaymentProviderRegistry {
  constructor({ merchantCountry, adapters = [] } = {}) {
    this.merchantCountry = String(merchantCountry || process.env.MERCHANT_COUNTRY || 'ZW').toUpperCase();
    this.adapters = new Map();
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter) {
    if (!adapter?.id) throw new Error('Payment provider adapter requires an id');
    assertProviderAllowed(adapter.id, this.merchantCountry);
    this.adapters.set(adapter.id, adapter);
    return adapter;
  }

  get(id) {
    return this.adapters.get(String(id || '').toLowerCase()) || null;
  }

  require(id) {
    const adapter = this.get(id);
    if (!adapter) throw new Error(`Payment provider '${id}' is not registered`);
    return adapter;
  }

  list({ operation } = {}) {
    return [...this.adapters.values()]
      .filter((adapter) => !operation || adapter.supports?.(operation))
      .map((adapter) => ({ id: adapter.id, capabilities: adapter.capabilities }));
  }

  capabilities(id) {
    return this.require(id).capabilities;
  }
}

export default PaymentProviderRegistry;
