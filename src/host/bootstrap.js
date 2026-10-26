import 'dotenv/config';
import * as databaseAdapter from '../adapters/persistence/database.js';
import * as firebaseAdapter from '../adapters/persistence/firebase.js';
import supabaseDatabaseAdapter from '../adapters/persistence/supabase-database.js';
import BillingAdapter from '../adapters/payments/universal-billing.js';
import FinancialService from '../services/financial.js';
import { registerDatabaseProvider } from '../core/database.js';
import { registerPersistenceProvider } from '../core/persistence.js';
import * as productQueryAdapter from '../adapters/persistence/product-query-service.js';
import { registerBillingProvider } from '../core/universal-billing.js';
import { registerFinancialProvider } from '../core/financial.js';
import nodeRegistry from '../core/node-registry.js';
import pluginRegistry from '../plugins/registry.js';
import PluginManager from '../plugins/manager.js';
import ServiceRegistry from '../services/registry.js';

const NETWORK_DOMAINS = new Set(['network', 'wifi', 'wifi-billing']);
const ACTIVE_DOMAIN = String(process.env.AGENTOS_DOMAIN || 'network').trim().toLowerCase();
const networkModules = NETWORK_DOMAINS.has(ACTIVE_DOMAIN)
  ? await Promise.all([
      import('../adapters/network/mikrotik.js'),
      import('../adapters/network/onboard.js'),
      import('../adapters/network/mikrotik-adapter.js'),
      import('../core/mikrotik.js'),
      import('../core/onboard.js')
    ])
  : null;
const networkAdapter = networkModules?.[0] || null;
const onboardingAdapter = networkModules?.[1] || null;
const MikroTikAdapter = networkModules?.[2]?.default || networkModules?.[2] || null;
const registerNetworkProvider = networkModules?.[3]?.registerNetworkProvider || null;
const registerOnboardingProvider = networkModules?.[4]?.registerOnboardingProvider || null;

export function bootstrapAgentOS() {
  if (networkAdapter && registerNetworkProvider) registerNetworkProvider(networkAdapter);
  if (onboardingAdapter && registerOnboardingProvider) registerOnboardingProvider(onboardingAdapter.default || onboardingAdapter);
  const requestedProvider = String(process.env.DATABASE_PROVIDER || 'auto').toLowerCase();
  const hasSupabase = Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY));
  const useSupabaseDatabase = requestedProvider === 'supabase' || (requestedProvider === 'auto' && hasSupabase);
  const activeDatabaseAdapter = useSupabaseDatabase ? supabaseDatabaseAdapter : databaseAdapter;
  registerDatabaseProvider(activeDatabaseAdapter);
  registerPersistenceProvider({
    ...activeDatabaseAdapter,
    getProductQueryService: productQueryAdapter.getProductQueryService,
    resetProductQueryServiceBridge: productQueryAdapter.resetProductQueryServiceBridge,
  });
  registerBillingProvider(BillingAdapter);
  registerFinancialProvider(FinancialService);
  if (networkAdapter) nodeRegistry.setManagerFactory(networkAdapter.createManager);
  if (MikroTikAdapter) pluginRegistry.register('mikrotik', MikroTikAdapter);
  return { networkAdapter, onboardingAdapter, databaseAdapter: activeDatabaseAdapter, legacyDatabaseAdapter: databaseAdapter, supabaseDatabaseAdapter, firebaseAdapter, BillingAdapter, FinancialService, nodeRegistry, pluginRegistry };
}

export function createExtensionRuntime(agent, options = {}) {
  const plugins = new PluginManager(agent, options.plugins || {});
  const services = new ServiceRegistry();
  return { plugins, services };
}

export const host = bootstrapAgentOS();
export default host;
