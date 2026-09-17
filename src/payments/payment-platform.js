import PaymentProviderRegistry from './provider-registry.js';
import LegacyProviderAdapter from './legacy-provider-adapter.js';
import PesaPalProvider from './providers/pesapay-provider.js';
import FinivexProvider from './providers/finivex-provider.js';
import SmilePayProvider from './providers/smilepay-provider.js';
import ZimswitchOnlineProvider from './providers/zimswitch-online-provider.js';
import PaynowProvider from './providers/paynow-provider.js';
import { createPaymentIdempotencyStore } from './idempotency-store.js';
import { createIdempotencyKey, normalizePaymentRequest } from './payment-guards.js';

const FACTORIES = Object.freeze({
  pesapay: (config) => new PesaPalProvider(config),
  finivex: (config) => new FinivexProvider(config),
  smilepay: (config) => new SmilePayProvider(config),
  zimswitch_online: (config) => new ZimswitchOnlineProvider(config),
  paynow: (config) => new PaynowProvider(config),
});

const REQUIRED = Object.freeze({
  paynow: ['paynowIntegrationId', 'paynowIntegrationKey'],
  pesapay: ['pesapayConsumerKey'],
  finivex: ['finivexApiKey', 'finivexApiSecret'],
  smilepay: ['smilepayApiKey'],
  zimswitch_online: ['zimswitchEntityId', 'zimswitchAuthorizationBearer'],
});

function envName(key) {
  return String(key).replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase();
}

function configured(key, config) {
  return Boolean(config[key] || process.env[envName(key)]);
}

function providerMethods(adapter, context = {}) {
  if (typeof adapter.getAvailableMethods === 'function') return adapter.getAvailableMethods(context);
  return [{
    id: adapter.id,
    provider: adapter.id,
    type: 'provider',
    name: adapter.id,
    capabilities: adapter.capabilities,
  }];
}

/** Build the canonical provider registry from merchant adapters and configured built-ins. */
export function createPaymentProviderRegistry(config = {}) {
  const country = String(config.merchantCountry || process.env.MERCHANT_COUNTRY || 'ZW').toUpperCase();
  const disabled = new Set(
    (Array.isArray(config.disabledPaymentProviders)
      ? config.disabledPaymentProviders
      : String(config.disabledPaymentProviders || '').split(','))
      .map((id) => String(id).trim().toLowerCase())
      .filter(Boolean),
  );
  const registry = new PaymentProviderRegistry({ merchantCountry: country });

  for (const adapter of config.adapters || []) {
    if (!adapter?.id || disabled.has(String(adapter.id).toLowerCase())) continue;
    try { registry.register(adapter); } catch { /* invalid/ineligible adapter stays unavailable */ }
  }

  for (const [id, factory] of Object.entries(FACTORIES)) {
    if (disabled.has(id) || registry.get(id)) continue;
    const required = REQUIRED[id] || [];
    if (required.some((key) => !configured(key, config))) continue;
    try {
      registry.register(new LegacyProviderAdapter(id, factory(config)));
    } catch {
      // Missing/invalid merchant configuration makes only this provider unavailable.
    }
  }
  return registry;
}

export function createPaymentPlatform(config = {}) {
  const registry = createPaymentProviderRegistry(config);
  const idempotency = config.idempotencyStore || createPaymentIdempotencyStore(config.idempotencyOptions);
  const defaultCurrency = config.defaultCurrency || process.env.DEFAULT_CURRENCY || 'USD';

  const createPayment = async (id, data = {}) => {
    const adapter = registry.require(id);
    const request = normalizePaymentRequest(data, { defaultCurrency });
    const key = data.idempotencyKey || createIdempotencyKey(id, request.reference);
    const existing = idempotency.get(key);
    if (existing) return existing;
    if (!idempotency.reserve(key, { provider: id, reference: request.reference })) return idempotency.get(key);
    try {
      const result = await adapter.createPayment(request);
      return idempotency.set(key, result);
    } catch (error) {
      idempotency.release(key);
      throw error;
    }
  };

  const handleWebhook = async (id, payload, headers = {}) => {
    const adapter = registry.require(id);
    const valid = await adapter.verifyWebhook(payload, headers);
    if (!valid) throw new Error(`Payment provider '${id}' webhook verification failed`);
    return adapter.processWebhook(payload, { headers });
  };

  return Object.freeze({
    registry,
    providers: () => registry.list(),
    provider: (id) => registry.require(id),
    capabilities: (id) => registry.capabilities(id),
    getAvailableMethods: async (context = {}) => {
      const methods = [];
      for (const adapter of registry.adapters.values()) {
        if (context.country && adapter.country && !adapter.country.includes(context.country)) continue;
        methods.push(...await providerMethods(adapter, context));
      }
      return methods;
    },
    createPayment,
    verifyPayment: (id, data) => registry.require(id).verifyPayment(data),
    refund: async (id, transactionId, amount, reason = '') => {
      const adapter = registry.require(id);
      if (typeof adapter.refundPayment === 'function') return adapter.refundPayment(transactionId, { amount, reason });
      return adapter.refund(transactionId, { amount, reason });
    },
    webhook: handleWebhook,
    handleWebhook,
    reconcile: (id, data) => registry.require(id).reconcile(data),
    close: () => idempotency.close?.(),
  });
}

export default createPaymentPlatform;
