import { getNetworkProvider } from '../../core/ports/network-device.js';

/**
 * Adapts the domain's plan-access request to the configured network provider.
 * The domain does not know whether the provider is RouterOS, another network
 * controller, or a test double.
 */
export function createHotspotPlanProvisioner({ provider = null } = {}) {
  return {
    async provisionPlanAccess({ username, password, profile = 'default', sharedUsers = 1 } = {}) {
      const network = provider || getNetworkProvider();
      if (typeof network?.executeTool !== 'function') throw new TypeError('Network provider must implement executeTool().');
      return network.executeTool('user.add', {
        username,
        password,
        profile,
        sharedUsers
      });
    }
  };
}

export default createHotspotPlanProvisioner;
