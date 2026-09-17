import PaymentProviderRegistry from './provider-registry.js';
import LegacyProviderAdapter from './legacy-provider-adapter.js';
import { createPaymentIdempotencyStore } from './idempotency-store.js';
import { createPaymentEvent } from './payment-event.js';
import { createSupabasePaymentPersistence } from './supabase-payment-persistence.js';
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

function envName(key) { return String(key).replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase(); }
function configured(key, config) { return Boolean(config[key] || process.env[envName(key)]); }

export function createPaymentProviderRegistry(config = {}) {
  const country = String(config.merchantCountry || process.env.MERCHANT_COUNTRY || 'ZW').toUpperCase();
  const disabled = new Set((Array.isArray(config.disabledPaymentProviders) ? config.disabledPaymentProviders : String(config.disabledPaymentProviders || '').split(','))
    .map((id) => String(id).trim().toLowerCase()).filter(Boolean));
  const registry = new PaymentProviderRegistry({ merchantCountry: country });
  for (const [id, factory] of Object.entries(FACTORIES)) {
    if (disabled.has(id)) continue;
    if ((REQUIRED[id] || []).some((key) => !configured(key, config))) continue;
    try { registry.register(new LegacyProviderAdapter(id, factory(config))); } catch { /* isolate invalid provider config */ }
  }
  return registry;
}

function methodsFromCapabilities(registry) {
  return registry.list().flatMap(({ id, capabilities = {} }) => (Array.isArray(capabilities.methods) ? capabilities.methods : []).map((method) => ({ ...method, provider: id })));
}

function normalizedWebhookEvent(provider, result = {}) {
  const status = String(result.status || (result.success === false ? 'failed' : 'pending')).toLowerCase();
  const type = result.type || (['succeeded', 'completed', 'paid', 'success'].includes(status) ? 'payment.succeeded' : ['failed', 'cancelled'].includes(status) ? `payment.${status}` : 'payment.pending');
  return createPaymentEvent({ ...result, provider, type, transactionId: result.transactionId || result.id, reference: result.reference || result.orderId || result.transactionId, metadata: result.metadata || {} });
}

function eventStatus(type) {
  return ({
    'payment.pending': 'pending',
    'payment.succeeded': 'succeeded',
    'payment.failed': 'failed',
    'payment.cancelled': 'cancelled',
    'payment.refunded': 'refunded',
    'payment.reversed': 'reversed',
    'payment.settled': 'settled',
  })[type] || 'pending';
}

export function createPaymentPlatform(config = {}) {
  const registry = createPaymentProviderRegistry(config);
  const idempotency = config.idempotencyStore || createPaymentIdempotencyStore(config.idempotencyOptions);
  const persistence = config.persistence || createSupabasePaymentPersistence();
  const platform = {
    registry,
    idempotency,
    persistence,
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
        if (persistence) {
          await persistence.upsertTransaction({
            transactionId: String(result.transactionId || result.id || reference),
            provider: providerId,
            reference: String(result.reference || reference),
            orderId: result.orderId || data.orderId,
            invoiceId: result.invoiceId || data.invoiceId,
            tenantId: result.tenantId || data.tenantId,
            amount: result.amount ?? data.amount ?? 0,
            currency: result.currency || data.currency || 'USD',
            status: eventStatus(result.status === 'success' ? 'payment.succeeded' : 'payment.pending'),
            paymentMethod: result.paymentMethod || data.paymentMethod,
            idempotencyKey: key,
            providerTransactionId: result.providerTransactionId || result.transactionId || result.id,
            metadata: result.metadata || {},
          });
        }
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
      const event = normalizedWebhookEvent(id, await adapter.processWebhook(payload, { headers }));
      if (persistence) {
        await persistence.insertEvent(event);
        await persistence.upsertTransaction({
          transactionId: event.transactionId,
          provider: event.provider,
          reference: event.reference,
          orderId: event.orderId,
          invoiceId: event.invoiceId,
          tenantId: event.tenantId,
          amount: event.amount ?? 0,
          currency: event.currency || 'USD',
          status: eventStatus(event.type),
          idempotencyKey: event.idempotencyKey,
          providerTransactionId: event.transactionId,
          metadata: event.metadata,
        });
      }
      return event;
    },
    reconcile: (id, data) => registry.require(id).reconcile(data),
  };
  return Object.freeze(platform);
}

export default createPaymentPlatform;
