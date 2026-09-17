import { PaymentGateway } from './payment-gateway.js';
import PaymentService from './payment-service.js';
import webhookHandler from './webhook-handler.js';
import PesaPalIntegration from './pesapay-integration.js';
import PesaPalProvider from './providers/pesapay-provider.js';
import setupPesaPalRoutes from './routes/pesapal-webhooks.js';
import setupPesaPalCommands from './commands/pesapal-commands.js';
import PaymentProviderRegistry from './provider-registry.js';
import { PaymentProviderAdapter, normalizePaymentResult } from './provider-adapter.js';
import { PAYMENT_PROVIDER_CATALOG, getProviderCatalog } from './provider-catalog.js';
import { applyPaymentProviderPolicy, assertProviderAllowed, isProviderAllowed } from './payment-provider-policy.js';

export default {
  PaymentGateway,
  PaymentService,
  PaymentProviderRegistry,
  PaymentProviderAdapter,
  normalizePaymentResult,
  PAYMENT_PROVIDER_CATALOG,
  getProviderCatalog,
  webhookHandler,
  PesaPalIntegration,
  PesaPalProvider,
  setupPesaPalRoutes,
  setupPesaPalCommands,
  applyPaymentProviderPolicy,
  assertProviderAllowed,
  isProviderAllowed,

  createPaymentService: (config = {}) => {
    const gatewayConfig = applyPaymentProviderPolicy(config);
    const gateway = new PaymentGateway(gatewayConfig);
    return new PaymentService(gateway);
  }
};
