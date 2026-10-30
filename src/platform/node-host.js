import { RuntimeEnvironment } from './runtime-environment.js';
import { nodeHardwareProvider } from './host-provider.js';

/**
 * Optional Node.js composition root. Other hosts should create their own
 * RuntimeEnvironment and register adapters appropriate to their capabilities.
 */
export function createNodeRuntimeEnvironment(options = {}) {
  const environment = new RuntimeEnvironment(options);
  environment.registerProvider(nodeHardwareProvider);
  return environment;
}
