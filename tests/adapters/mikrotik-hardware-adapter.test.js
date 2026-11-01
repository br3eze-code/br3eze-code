import { describe, expect, test, jest } from '@jest/globals';
import { createMikroTikHardwareAdapter } from '../../src/adapters/hardware/mikrotik-hardware-adapter.js';

describe('MikroTik hardware adapter', () => {
  test('declares read-only capabilities and delegates to existing network adapter', async () => {
    const manager = {
      executeTool: jest.fn(async (name) => ({ tool: name, ok: true })),
      disconnect: jest.fn(async () => {}),
    };
    const adapter = createMikroTikHardwareAdapter({ id: 'router-a', deviceId: 'site-a', manager });

    expect(adapter.capabilities.map((capability) => [capability.name, capability.access])).toEqual([
      ['system_stats', 'read'],
      ['interfaces_list', 'read'],
      ['hotspot_active_users', 'read'],
    ]);
    await expect(adapter.capabilities[0].execute({}, { signal: new AbortController().signal, tenantId: 't', userId: 'u' }))
      .resolves.toEqual({ tool: 'system.stats', ok: true });
    await expect(adapter.capabilities[1].execute({}, { signal: new AbortController().signal }))
      .resolves.toEqual({ tool: 'interface.list', ok: true });
    expect(manager.executeTool).toHaveBeenNthCalledWith(1, 'system.stats');
    expect(manager.executeTool).toHaveBeenNthCalledWith(2, 'interface.list');
    await adapter.close();
    expect(manager.disconnect).toHaveBeenCalledTimes(1);
  });

  test('reports cancellation after an in-flight read resolves', async () => {
    let resolveRead;
    const manager = {
      executeTool: jest.fn(() => new Promise((resolve) => { resolveRead = resolve; })),
    };
    const adapter = createMikroTikHardwareAdapter({ manager });
    const controller = new AbortController();
    const pending = adapter.capabilities[0].execute({}, { signal: controller.signal });
    await Promise.resolve();
    controller.abort(new Error('cancelled in flight'));
    resolveRead({ ok: true });
    await expect(pending).rejects.toThrow('cancelled in flight');
  });

  test('does not dispatch when cancellation was already requested', async () => {
    const manager = { executeTool: jest.fn() };
    const adapter = createMikroTikHardwareAdapter({ manager });
    const controller = new AbortController();
    controller.abort(new Error('cancelled by caller'));

    await expect(adapter.capabilities[0].execute({}, { signal: controller.signal }))
      .rejects.toThrow('cancelled by caller');
    expect(manager.executeTool).not.toHaveBeenCalled();
  });
});
