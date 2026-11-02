import os from 'node:os';

const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {},
  additionalProperties: false,
});

const HOST_METHODS = ['platform', 'arch', 'release', 'cpus', 'totalmem', 'freemem', 'uptime'];

/**
 * Read-only Node.js host diagnostics exposed through the canonical
 * HardwareCapabilityRegistry and ToolRegistry path. No shell or process access.
 */
export function createNodeHostHardwareAdapter({ osModule = os, id = 'nodehost' } = {}) {
  if (!osModule || HOST_METHODS.some((method) => typeof osModule[method] !== 'function')) {
    throw new TypeError('a compatible Node.js os module is required');
  }
  if (typeof id !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/i.test(id)) {
    throw new TypeError('adapter id must be a stable hardware adapter identifier');
  }

  return {
    id,
    kind: 'host-runtime',
    capabilities: [{
      name: 'diagnostics',
      description: 'Read basic host runtime diagnostics without shell access',
      access: 'read',
      schema: EMPTY_OBJECT_SCHEMA,
      execute: async () => ({
        platform: osModule.platform(),
        architecture: osModule.arch(),
        release: osModule.release(),
        cpuCount: osModule.cpus().length,
        totalMemoryBytes: osModule.totalmem(),
        freeMemoryBytes: osModule.freemem(),
        uptimeSeconds: osModule.uptime(),
      }),
    }],
  };
}

export default createNodeHostHardwareAdapter;
