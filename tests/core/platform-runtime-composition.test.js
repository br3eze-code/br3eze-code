import { describe, expect, test } from '@jest/globals';
import { AgentRuntime } from '../../src/core/agentRuntime.js';
import { createNodeHostAdapter } from '../../src/adapters/platform/node-host-adapter.js';

describe('Br3eze OS platform runtime composition', () => {
  test('owns platform adapters inside the canonical AgentRuntime instance', async () => {
    const runtime = new AgentRuntime({
      toolRegistry: { execute: async () => ({}), getTool: () => null, getAllTools: () => [] },
      platformHostAdapters: [{
        id: 'test.host',
        capabilities: [{ name: 'identity', platforms: ['test'], invoke: async (_input, context) => ({ platform: context.platform }) }],
      }],
    });
    expect(runtime.listPlatformCapabilities({ platform: 'test' })).toHaveLength(1);
    await runtime.startPlatformAdapter('test.host');
    await expect(runtime.invokePlatformCapability('platform.test.host.identity', {}, { platform: 'test' }))
      .resolves.toEqual({ platform: 'test' });
  });

  test('Node.js host adapter exposes diagnostics only and does not run commands', async () => {
    const adapter = createNodeHostAdapter({
      osModule: {
        platform: () => 'test-os',
        arch: () => 'test-arch',
        release: () => '1.0',
        cpus: () => [{}, {}],
        totalmem: () => 1000,
        freemem: () => 400,
        uptime: () => 12,
      },
    });
    const runtime = new AgentRuntime({
      toolRegistry: { execute: async () => ({}), getTool: () => null, getAllTools: () => [] },
      platformHostAdapters: [adapter],
    });
    await runtime.startPlatformAdapter('host.node');
    await expect(runtime.invokePlatformCapability('platform.host.node.diagnostics'))
      .resolves.toEqual({
        platform: 'test-os', architecture: 'test-arch', release: '1.0',
        cpuCount: 2, totalMemoryBytes: 1000, freeMemoryBytes: 400, uptimeSeconds: 12,
      });
    expect(runtime.listPlatformCapabilities({ platform: 'node' })).toHaveLength(1);
  });
});
