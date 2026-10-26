import { MikroTikManager } from '../network/mikrotik.js';

const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {},
  additionalProperties: false,
});

/**
 * Read-only RouterOS hardware adapter for the generic AgentOS capability port.
 * Credentials remain in the host's existing network-adapter configuration.
 */
export function createMikroTikHardwareAdapter(options = {}) {
  const id = options.id || 'mikrotik';
  const manager = options.manager || new MikroTikManager(options.connection || options);

  const read = (toolName) => async (_args, context) => {
    if (context.signal?.aborted) {
      throw context.signal.reason || new Error('RouterOS operation cancelled before dispatch');
    }
    const result = await manager.executeTool(toolName);
    if (context.signal?.aborted) {
      throw context.signal.reason || new Error('RouterOS operation cancelled');
    }
    return result;
  };

  return {
    id,
    deviceId: options.deviceId || options.siteId || id,
    kind: 'network-router',
    capabilities: [
      {
        name: 'system_stats',
        description: 'Read RouterOS system resource statistics (read-only)',
        access: 'read',
        schema: EMPTY_OBJECT_SCHEMA,
        execute: read('system.stats'),
      },
      {
        name: 'interfaces_list',
        description: 'List RouterOS interfaces (read-only)',
        access: 'read',
        schema: EMPTY_OBJECT_SCHEMA,
        execute: read('interface.list'),
      },
      {
        name: 'hotspot_active_users',
        description: 'List active RouterOS hotspot users (read-only)',
        access: 'read',
        schema: EMPTY_OBJECT_SCHEMA,
        execute: read('users.active'),
      },
    ],
    async close() {
      await manager.disconnect?.();
    },
  };
}

export default createMikroTikHardwareAdapter;
