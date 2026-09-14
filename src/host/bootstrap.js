import * as networkAdapter from '../adapters/network/mikrotik.js';
import * as onboardingAdapter from '../adapters/network/onboard.js';
import * as databaseAdapter from '../adapters/persistence/database.js';
import * as firebaseAdapter from '../adapters/persistence/firebase.js';
import BillingAdapter from '../adapters/payments/universal-billing.js';
import FinancialService from '../services/financial.js';
import MikroTikAdapter from '../adapters/network/mikrotik-adapter.js';
import { registerNetworkProvider } from '../core/ports/network-device.js';
import { registerOnboardingProvider } from '../core/ports/onboarding.js';
import { registerDatabaseProvider } from '../core/ports/database.js';
import { registerPersistenceProvider } from '../core/ports/persistence.js';
import { registerBillingProvider } from '../core/ports/billing.js';
import { registerFinancialProvider } from '../core/ports/finance.js';
import nodeRegistry from '../core/node-registry.js';
import pluginRegistry from '../plugins/registry.js';
import PluginManager from '../plugins/manager.js';
import ServiceRegistry from '../services/registry.js';

export function bootstrapAgentOS() {
  registerNetworkProvider(networkAdapter);
  registerOnboardingProvider(onboardingAdapter.default || onboardingAdapter);
  registerDatabaseProvider(databaseAdapter);
  registerPersistenceProvider(firebaseAdapter.default || firebaseAdapter);
  registerBillingProvider(BillingAdapter);
  registerFinancialProvider(FinancialService);
  nodeRegistry.setManagerFactory(networkAdapter.createManager);
  pluginRegistry.register('mikrotik', MikroTikAdapter);
  return { networkAdapter, onboardingAdapter, databaseAdapter, firebaseAdapter, BillingAdapter, FinancialService, nodeRegistry, pluginRegistry };
}

export function createExtensionRuntime(agent, options = {}) {
  const plugins = new PluginManager(agent, options.plugins || {});
  const services = new ServiceRegistry();
  return { plugins, services };
}

export const host = bootstrapAgentOS();
export default host;
