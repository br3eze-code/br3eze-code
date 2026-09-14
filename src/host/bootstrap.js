import * as networkAdapter from '../adapters/network/mikrotik.js';
import * as onboardingAdapter from '../adapters/network/onboard.js';
import * as databaseAdapter from '../adapters/persistence/database.js';
import * as firebaseAdapter from '../adapters/persistence/firebase.js';
import BillingAdapter from '../adapters/payments/universal-billing.js';
import MikroTikAdapter from '../adapters/network/mikrotik-adapter.js';
import { registerNetworkProvider } from '../core/mikrotik.js';
import { registerOnboardingProvider } from '../core/onboard.js';
import { registerDatabaseProvider } from '../core/database.js';
import { registerPersistenceProvider } from '../core/firebase.js';
import { registerBillingProvider } from '../core/universal-billing.js';
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
  nodeRegistry.setManagerFactory(networkAdapter.createManager);
  pluginRegistry.register('mikrotik', MikroTikAdapter);
  return { networkAdapter, onboardingAdapter, databaseAdapter, firebaseAdapter, BillingAdapter, nodeRegistry, pluginRegistry };
}

export function createExtensionRuntime(agent, options = {}) {
  const plugins = new PluginManager(agent, options.plugins || {});
  const services = new ServiceRegistry();
  return { plugins, services };
}

export const host = bootstrapAgentOS();
export default host;
