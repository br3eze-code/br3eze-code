import PaymentProviderRegistry from './provider-registry.js';
import LegacyProviderAdapter from './legacy-provider-adapter.js';
import { createPaymentIdempotencyStore } from './idempotency-store.js';
import PesaPalProvider from './providers/pesapay-provider.js';
import FinivexProvider from './providers/finivex-provider.js';
import SmilePayProvider from './providers/smilepay-provider.js';
import ZimswitchOnlineProvider from './providers/zimswitch-online-provider.js';
import PaynowProvider from './providers/paynow-provider.js';

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

  for (const [id, factory] of Object.entries(FACTORIES)) {
    if (disabled.has(id)) continue;
    const required = REQUIRED[id] || [];
    if (required.some((key) => !configured(key, config))) continue;
    try {
      registry.register(new LegacyProviderAdapter(id, factory(config)));
    } catch {
      // Invalid merchant configuration makes only this provider unavailable.
    }
  }
  return registry;
}

function methodsFromCapabilities(registry) {
  return registry.list().flatMap(({ id, capabilities = {} }) => {
    const methods = Array.isArray(capabilities.methods) ? capabilities.methods : [];
    return methods.map((method) => ({ ...method, provider: id }));
  });
}

export function createPaymentPlatform(config = {}) {
  const registry = createPaymentProviderRegistry(config);
  const idempotency = config.idempotencyStore || createPaymentIdempotencyStore(config.idempotencyOptions);

  const platform = {
    registry,
    idempotency,
    providers: (options = {}) => registry.list(options),
    provider: (id) => registry.require(id),
    capabilities: (id) => registry.capabilities(id),
    getAvailablePaymentMethods: () => methodsFromCapabilities(registry),

    async createPayment(providerId, data = {}) {
      const reference = data.reference || data.paymentId || data.idempotencyKey;
      if (!reference) throw new TypeError('payment reference or idempotencyKey is required');
      const key = data.idempotencyKey || `payment:${providerId}:${reference}`;
      const previous = idempotency.get(key);
      if (previous) return previous;
      if (typeof idempotency.reserve === 'function' && !idempotency.reserve(key, { provider: providerId, reference })) {
        const concurrent = idempotency.get(key);
        if (concurrent) return concurrent;
        throw new Error('Payment request is already being processed');
      }
      try {
        const result = await registry.require(providerId).createPayment({ ...data, idempotencyKey: key });
        return idempotency.set(key, result);
      } catch (error) {
        if (typeof idempotency.release === 'function') idempotency.release(key);
        throw error;
      }
    },

    verifyPayment: (id, data) => registry.require(id).verifyPayment(data),
    refund: async (id, transactionId, amount, reason = '') => registry.require(id).refundPayment(transactionId, { amount, reason }),
    webhook: async (id, payload, headers = {}) => {
      const adapter = registry.require(id);
      const valid = await adapter.verifyWebhook(payload, headers);
      if (!valid) throw new Error(`Payment provider '${id}' webhook verification failed`);
      return adapter.processWebhook(payload, { headers });
    },
    reconcile: (id, data) => registry.require(id).reconcile(data),
  };

  return Object.freeze(platform);
}

export default createPaymentPlatform;
