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
    await expect(runtime.invokePlatformCapability('platform.test.host.identity', {}, { tenantId: 'tenant-a', userId: 'user-a', authorizedCapabilities: ['platform:test.host:identity'], platform: 'test' }))
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
    await expect(runtime.invokePlatformCapability('platform.host.node.diagnostics', {}, { tenantId: 'tenant-a', userId: 'user-a', authorizedCapabilities: ['platform:host.node:diagnostics'] }))
      .resolves.toEqual({
        platform: 'test-os', architecture: 'test-arch', release: '1.0',
        cpuCount: 2, totalMemoryBytes: 1000, freeMemoryBytes: 400, uptimeSeconds: 12,
      });
    expect(runtime.listPlatformCapabilities({ platform: 'node' })).toHaveLength(1);
  });

  test('canonical runtime exposes managed app state and fail-closed IPC policy', async () => {
    const received = [];
    const state = {
      get: async () => 'value',
      set: async () => ({ saved: true }),
      delete: async () => true,
      list: async () => ['key'],
    };
    const runtime = new AgentRuntime({
      toolRegistry: { execute: async () => ({}), getTool: () => null, getAllTools: () => [] },
      localState: state,
      ipcAuthorize: ({ action, topic, tenantId, userId }) =>
        action === 'publish' && action !== 'subscribe' && topic === 'demo.events' && tenantId === 'tenant-a' && userId === 'user-a',
    });
    await expect(runtime.getAppState({ tenantId: 'tenant-a', appId: 'demo.app', key: 'key' })).resolves.toBe('value');
    await expect(runtime.setAppState({ tenantId: 'tenant-a', appId: 'demo.app', key: 'key', value: 1 })).resolves.toEqual({ saved: true });
    await expect(runtime.publishIPC({ topic: 'demo.events', publisherId: 'app-a', tenantId: 'tenant-a', userId: 'user-a' }, { ok: true })).resolves.toMatchObject({ delivered: 0 });
    await expect(runtime.publishIPC({ topic: 'demo.events', publisherId: 'app-a', tenantId: 'tenant-b', userId: 'user-b' }, { ok: true })).rejects.toThrow('missing_permission');
  });

  test('graceful shutdown stops registered services', async () => {
    const stop = [];
    const runtime = new AgentRuntime({
      toolRegistry: { execute: async () => ({}), getTool: () => null, getAllTools: () => [] },
    });
    runtime.registerService({ id: 'shutdown.service', start: async () => {}, stop: async () => { stop.push(true); } });
    await runtime.startService('shutdown.service');
    await runtime.shutdownOS();
    expect(stop).toHaveLength(1);
    expect(runtime.listServices()[0].state).toBe('stopped');
  });
});
