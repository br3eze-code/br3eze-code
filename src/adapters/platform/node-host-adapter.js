import os from 'node:os';

/**
 * Read-only host adapter for the first Br3eze OS target.
 * Does not execute shell commands or expose raw device handles.
 */
export function createNodeHostAdapter({ osModule = os } = {}) {
  if (!osModule || typeof osModule.platform !== 'function' || typeof osModule.arch !== 'function') {
    throw new TypeError('a compatible Node.js os module is required');
  }
  return {
    id: 'host.node',
    capabilities: [{
      name: 'diagnostics',
      access: 'read',
      platforms: ['node'],
      description: 'Read basic host runtime diagnostics without shell access',
      invoke: async () => ({
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

export default createNodeHostAdapter;
