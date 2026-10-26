import BaseDomain from '../BaseDomain.js';
import { MikroTikManager } from '../../adapters/network/mikrotik.js';

class MikroTikDomain extends BaseDomain {
  constructor(config) {
    super();
    this.name = 'mikrotik';
    this.client = new MikroTikManager(config);

    this.registerTool({
      name: 'getStats',
      description: 'Get router system statistics',
      execute: async () => this.client.getSystemStats()
    });

    this.registerTool({
      name: 'getArp',
      description: 'Get ARP table',
      execute: async () => this.client.getArpTable()
    });

    this.registerTool({
      name: 'reboot',
      description: 'Reboot the router',
      requiresApproval: true,
      risk: 'critical',
      passContext: true,
      execute: async (params = {}, context = {}) => {
        if (context.approvalGranted !== true) throw new Error('Router reboot requires explicit approval');
        return this.client.reboot({ approvalGranted: true });
      }
    });
  }
}

export default MikroTikDomain;