// src/payments/index.js
// Payment module entry point for AgentOS

import { PaymentGateway } from './payment-gateway.js';
import PaymentService from './payment-service.js';
import webhookHandler from './webhook-handler.js';

import PesaPalIntegration from './pesapay-integration.js';
import PesaPalProvider from './providers/pesapay-provider.js';
import setupPesaPalRoutes from './routes/pesapal-webhooks.js';
import setupPesaPalCommands from './commands/pesapal-commands.js';


module.exports = {
  PaymentGateway,
  PaymentService,
  webhookHandler,
   PesaPalIntegration,
  PesaPalProvider,
  setupPesaPalRoutes,
  setupPesaPalCommands,
  
  // Factory function for easy initialization
  
  createPaymentService: (config) => {
    const gateway = new PaymentGateway(config);
    return new PaymentService(gateway);
  }
};
