import PaymentService from './payment-service.js';
import PaymentPlatform, { createPaymentPlatform, createPaymentProviderRegistry } from './payment-platform.js';
import webhookHandler from './webhook-handler.js';
import PesaPalIntegration from './pesapay-integration.js';
import PesaPalProvider from './providers/pesapay-provider.js';
import FinivexProvider from './providers/finivex-provider.js';
import ZimswitchOnlineProvider from './providers/zimswitch-online-provider.js';
import SmilePayProvider from './providers/smilepay-provider.js';
import setupPesaPalRoutes from './routes/pesapal-webhooks.js';
import setupPesaPalCommands from './commands/pesapal-commands.js';
import PaymentProviderRegistry from './provider-registry.js';
import { PaymentProviderAdapter, normalizePaymentResult } from './provider-adapter.js';
import LegacyProviderAdapter from './legacy-provider-adapter.js';
import { PAYMENT_PROVIDER_CATALOG, getProviderCatalog, listZimbabweProviders } from './provider-catalog.js';
import { PAYMENT_RAILS, providersForRail } from './provider-rails.js';
import { applyPaymentProviderPolicy, assertProviderAllowed, isProviderAllowed } from './payment-provider-policy.js';

export default {
  PaymentPlatform,
  PaymentService,
  PaymentProviderRegistry,
  PaymentProviderAdapter,
  LegacyProviderAdapter,
  normalizePaymentResult,
  PAYMENT_PROVIDER_CATALOG,
  PAYMENT_RAILS,
  getProviderCatalog,
  listZimbabweProviders,
  providersForRail,
  createPaymentPlatform,
  createPaymentProviderRegistry,
  FinivexProvider,
  ZimswitchOnlineProvider,
  SmilePayProvider,
  webhookHandler,
  PesaPalIntegration,
  PesaPalProvider,
  setupPesaPalRoutes,
  setupPesaPalCommands,
  applyPaymentProviderPolicy,
  assertProviderAllowed,
  isProviderAllowed,

  createPaymentService: (config = {}) => new PaymentService(createPaymentPlatform(config)),
};
