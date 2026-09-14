import * as networkAdapter from '../adapters/network/mikrotik.js';
import * as onboardingAdapter from '../adapters/network/onboard.js';
import * as databaseAdapter from '../adapters/persistence/database.js';
import * as firebaseAdapter from '../adapters/persistence/firebase.js';
import MikroTikAdapter from '../adapters/network/mikrotik-adapter.js';
import { registerNetworkProvider } from '../core/mikrotik.js';
import { registerOnboardingProvider } from '../core/onboard.js';
import { registerDatabaseProvider } from '../core/database.js';
import { registerPersistenceProvider } from '../core/firebase.js';
import nodeRegistry from '../core/node-registry.js';
import pluginRegistry from '../plugins/registry.js';

/** Host composition root: the only place where concrete providers enter Core. */
export function bootstrapAgentOS() {
  registerNetworkProvider(networkAdapter);
  registerOnboardingProvider(onboardingAdapter.default || onboardingAdapter);
  registerDatabaseProvider(databaseAdapter);
  registerPersistenceProvider(firebaseAdapter.default || firebaseAdapter);
  nodeRegistry.setManagerFactory(networkAdapter.createManager);

  // Concrete adapters are registered here, not inside the domain-neutral registry.
  pluginRegistry.register('mikrotik', MikroTikAdapter);

  return { networkAdapter, onboardingAdapter, databaseAdapter, firebaseAdapter, nodeRegistry, pluginRegistry };
}

export const host = bootstrapAgentOS();
export default host;
