import { describe, expect, test, jest } from '@jest/globals';
import { AgentRuntime } from '../../src/core/agentRuntime.js';

describe('AgentRuntime OS ownership', () => {
  test('owns application lifecycle, IPC and local state behind one runtime', async () => {
    const state = {
      get: jest.fn(async () => ({ saved: true })),
      set: jest.fn(async () => ({ stored: true })),
      delete: jest.fn(async () => true),
      list: jest.fn(async () => ['settings']),
    };
    const runtime = new AgentRuntime({
      toolRegistry: { execute: async () => ({}), getTool: () => null, getAllTools: () => [] },
      localState: state,
      ipcAuthorize: ({ action, topic, tenantId, userId }) =>
        action === 'publish' && topic === 'app.events' && tenantId === 'tenant-a' && userId === 'user-a',
    });
    const start = jest.fn(async () => {});
    const stop = jest.fn(async () => {});
    runtime.registerApplication(
      { id: 'billing.app', version: '1.0.0', entryService: 'billing.service' },
      { id: 'billing.service', start, stop },
    );
    await runtime.startApplication('billing.app', { tenantId: 'tenant-a', userId: 'user-a' });
    expect(runtime.listApplications()[0].state).toBe('running');
    expect(start).toHaveBeenCalledTimes(1);

    await expect(runtime.getAppState({ tenantId: 'tenant-a', appId: 'billing.app', key: 'settings' }))
      .resolves.toEqual({ saved: true });
    await expect(runtime.setAppState({ tenantId: 'tenant-a', appId: 'billing.app', key: 'settings', value: true }))
      .resolves.toEqual({ stored: true });
    await expect(runtime.publishIPC({
      topic: 'app.events', publisherId: 'billing.app', tenantId: 'tenant-a', userId: 'user-a',
    }, { ok: true })).resolves.toMatchObject({ delivered: 0 });

    await runtime.shutdownOS();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(runtime.listServices()[0].state).toBe('stopped');
    expect(state.get).toHaveBeenCalledTimes(1);
    expect(state.set).toHaveBeenCalledTimes(1);
  });

  test('fails closed when IPC policy is not configured', async () => {
    const runtime = new AgentRuntime({
      toolRegistry: { execute: async () => ({}), getTool: () => null, getAllTools: () => [] },
      localState: { get: async () => undefined, set: async () => {}, delete: async () => false, list: async () => [] },
    });
    await expect(runtime.publishIPC({
      topic: 'app.events', publisherId: 'app', tenantId: 'tenant-a', userId: 'user-a',
    }, { value: 1 })).rejects.toThrow('missing_permission');
  });
});
