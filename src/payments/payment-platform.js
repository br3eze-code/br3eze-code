import PaymentProviderRegistry from './provider-registry.js';
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

/**
 * Build the normalized payment provider registry from configured credentials.
 * Missing credentials are skipped; no provider is marked live merely by being catalogued.
 */
export function createPaymentProviderRegistry(config = {}) {
  const country = String(config.merchantCountry || process.env.MERCHANT_COUNTRY || 'ZW').toUpperCase();
  const disabled = new Set([
    ...(Array.isArray(config.disabledPaymentProviders) ? config.disabledPaymentProviders : String(config.disabledPaymentProviders || '').split(',')),
  ].map((id) => String(id).trim().toLowerCase()).filter(Boolean));
  const registry = new PaymentProviderRegistry({ merchantCountry: country });

  for (const [id, factory] of Object.entries(FACTORIES)) {
    if (disabled.has(id)) continue;
    try {
      const adapter = factory(config);
      const required = {
        paynow: ['paynowIntegrationId', 'paynowIntegrationKey'],
        pesapay: ['pesapayConsumerKey'],
        finivex: ['finivexApiKey', 'finivexApiSecret'],
        smilepay: ['smilepayApiKey'],
        zimswitch_online: ['zimswitchEntityId', 'zimswitchAuthorizationBearer'],
      }[id] || [];
      if (required.some((key) => !(config[key] || process.env[key.replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase()]))) continue;
      registry.register(adapter);
    } catch {
      // A provider with incomplete merchant configuration is unavailable, not broken globally.
    }
  }

  return registry;
}

export function createPaymentPlatform(config = {}) {
  const registry = createPaymentProviderRegistry(config);
  return Object.freeze({
    registry,
    providers: () => registry.list(),
    provider: (id) => registry.require(id),
    capabilities: (id) => registry.capabilities(id),
    createPayment: (id, data) => registry.require(id).createPayment(data),
    verifyPayment: (id, data) => registry.require(id).verifyPayment(data),
    refund: (id, data) => registry.require(id).refund(data),
    webhook: (id, payload, headers) => registry.require(id).processWebhook(payload, headers),
    reconcile: (id, data) => registry.require(id).reconcile(data),
  });
}

export default createPaymentPlatform;
