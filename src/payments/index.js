// src/payments/index.js
// Payment module entry point for AgentOS

const { PaymentGateway } = require('./payment-gateway');
const PaymentService = require('./payment-service');
const webhookHandler = require('./webhook-handler');

const PesaPalIntegration = require('./pesapay-integration');
const PesaPalProvider = require('./providers/pesapay-provider');
const setupPesaPalRoutes = require('./routes/pesapal-webhooks');
const setupPesaPalCommands = require('./commands/pesapal-commands');


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