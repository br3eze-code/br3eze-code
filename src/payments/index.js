import { PaymentGateway } from './payment-gateway.js';
import PaymentService from './payment-service.js';
import webhookHandler from './webhook-handler.js';
import PesaPalIntegration from './pesapay-integration.js';
import PesaPalProvider from './providers/pesapay-provider.js';
import setupPesaPalRoutes from './routes/pesapal-webhooks.js';
import setupPesaPalCommands from './commands/pesapal-commands.js';
import { applyPaymentProviderPolicy, assertProviderAllowed, isProviderAllowed } from './payment-provider-policy.js';

// src/payments/index.js
// Payment module entry point for AgentOS.
// Merchant eligibility is kept separate from provider credentials.

export default {
  PaymentGateway,
  PaymentService,
  webhookHandler,
  PesaPalIntegration,
  PesaPalProvider,
  setupPesaPalRoutes,
  setupPesaPalCommands,
  applyPaymentProviderPolicy,
  assertProviderAllowed,
  isProviderAllowed,

  // Factory function for easy initialization. The policy is applied before
  // credentials reach the payment gateway so known jurisdiction/provider
  // conflicts are disabled centrally.
  createPaymentService: (config = {}) => {
    const gatewayConfig = applyPaymentProviderPolicy(config);
    const gateway = new PaymentGateway(gatewayConfig);
    return new PaymentService(gateway);
  }
};
