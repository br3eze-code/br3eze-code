import { describe, expect, test, jest } from '@jest/globals';
import { createMikroTikHardwareAdapter } from '../../src/adapters/hardware/mikrotik-hardware-adapter.js';

describe('MikroTik hardware adapter', () => {
  test('exposes only the three declared read-only operations', async () => {
    const manager = {
      executeTool: jest.fn(async (name) => ({ tool: name, ok: true })),
      disconnect: jest.fn(async () => {}),
    };
    const adapter = createMikroTikHardwareAdapter({ id: 'router-a', deviceId: 'site-a', manager });

    expect(adapter.capabilities.map(({ name, access }) => [name, access])).toEqual([
      ['system_stats', 'read'],
      ['interfaces_list', 'read'],
      ['hotspot_active_users', 'read'],
    ]);
    await expect(adapter.capabilities[0].execute({}, { signal: new AbortController().signal }))
      .resolves.toEqual({ tool: 'system.stats', ok: true });
    await expect(adapter.capabilities[1].execute({}, { signal: new AbortController().signal }))
      .resolves.toEqual({ tool: 'interface.list', ok: true });
    await expect(adapter.capabilities[2].execute({}, { signal: new AbortController().signal }))
      .resolves.toEqual({ tool: 'users.active', ok: true });
    expect(manager.executeTool).toHaveBeenNthCalledWith(1, 'system.stats');
    expect(manager.executeTool).toHaveBeenNthCalledWith(2, 'interface.list');
    expect(manager.executeTool).toHaveBeenNthCalledWith(3, 'users.active');
    await adapter.close();
    expect(manager.disconnect).not.toHaveBeenCalled();
  });

  test('does not dispatch after cancellation and does not own an injected manager', async () => {
    const manager = { executeTool: jest.fn(), disconnect: jest.fn() };
    const adapter = createMikroTikHardwareAdapter({ manager });
    const controller = new AbortController();
    controller.abort(new Error('cancelled by caller'));

    await expect(adapter.capabilities[0].execute({}, { signal: controller.signal }))
      .rejects.toThrow('cancelled by caller');
    expect(manager.executeTool).not.toHaveBeenCalled();
    await adapter.close();
    expect(manager.disconnect).not.toHaveBeenCalled();
  });
});
