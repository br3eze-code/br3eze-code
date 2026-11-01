import os from 'node:os';

/**
 * Node host adapter for best-effort hardware facts. This adapter is optional;
 * browser, embedded, remote and test hosts can provide their own implementation.
 */
export const nodeHardwareProvider = Object.freeze({
  id: 'host.node',
  kind: 'hardware',
  version: '1.0.0',
  capabilities: ['hardware.profile'],
  async probe({ signal } = {}) {
    if (signal?.aborted) throw signal.reason ?? new Error('Hardware probe aborted');
    return {
      platform: process.platform,
      architecture: process.arch,
      release: os.release(),
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
      uptimeSeconds: os.uptime(),
      accelerators: [],
      features: ['node-runtime'],
      source: 'node:os',
    };
  },
});
