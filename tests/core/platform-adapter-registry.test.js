import { describe, expect, test, jest } from '@jest/globals';
import { PlatformAdapterRegistry } from '../../src/core/platform/PlatformAdapterRegistry.js';

describe('PlatformAdapterRegistry', () => {
  test('starts once and invokes a declared capability with platform context', async () => {
    const start = jest.fn(async () => {});
    const invoke = jest.fn(async (_input, context) => ({ platform: context.platform }));
    const registry = new PlatformAdapterRegistry();
    registry.register({ id: 'host.runtime', start, capabilities: [{ name: 'device.info', invoke }] });
    await registry.start('host.runtime');
    await registry.start('host.runtime');
    await expect(registry.invoke('platform.host.runtime.device.info', {}, { tenantId: 'tenant-a', userId: 'user-a', authorizedCapabilities: ['platform:host.runtime:device.info'], platform: 'linux' })).resolves.toEqual({ platform: 'linux' });
    expect(start).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test('rejects calls until adapter is ready', async () => {
    const registry = new PlatformAdapterRegistry();
    registry.register({ id: 'host.runtime', capabilities: [{ name: 'device.info', invoke: async () => ({}) }] });
    await expect(registry.invoke('platform.host.runtime.device.info')).rejects.toThrow('not ready');
  });

  test('requires explicit approval for writes', async () => {
    const invoke = jest.fn(async () => ({ ok: true }));
    const registry = new PlatformAdapterRegistry();
    registry.register({ id: 'host.runtime', capabilities: [{ name: 'device.write', access: 'write', invoke }] });
    await registry.start('host.runtime');
    await expect(registry.invoke('platform.host.runtime.device.write', {}, { tenantId: 'tenant-a', userId: 'user-a', authorizedCapabilities: ['platform:host.runtime:device.write'] })).rejects.toThrow('explicit approval');
    expect(invoke).not.toHaveBeenCalled();
    await expect(registry.invoke('platform.host.runtime.device.write', {}, { tenantId: 'tenant-a', userId: 'user-a', authorizedCapabilities: ['platform:host.runtime:device.write'], approvalGranted: true })).resolves.toEqual({ ok: true });
  });

  test('rejects pre-aborted calls', async () => {
    const invoke = jest.fn();
    const registry = new PlatformAdapterRegistry();
    registry.register({ id: 'host.runtime', capabilities: [{ name: 'device.info', invoke }] });
    await registry.start('host.runtime');
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(registry.invoke('platform.host.runtime.device.info', {}, { tenantId: 'tenant-a', userId: 'user-a', authorizedCapabilities: ['platform:host.runtime:device.info'], signal: controller.signal })).rejects.toThrow('cancelled');
    expect(invoke).not.toHaveBeenCalled();
  });

  test('filters capabilities by platform and preserves universal capabilities', () => {
    const registry = new PlatformAdapterRegistry();
    registry.register({ id: 'mobile.bridge', capabilities: [
      { name: 'camera', platforms: ['android', 'ios'], invoke: async () => ({}) },
      { name: 'system.info', platforms: ['any'], invoke: async () => ({}) },
    ] });
    expect(registry.listCapabilities({ platform: 'ios' }).map((item) => item.name)).toEqual(['camera', 'system.info']);
    expect(registry.listCapabilities({ platform: 'windows' }).map((item) => item.name)).toEqual(['system.info']);
  });

  test('rejects duplicate capabilities atomically', () => {
    const registry = new PlatformAdapterRegistry();
    expect(() => registry.register({ id: 'host.runtime', capabilities: [
      { name: 'device.info', invoke: async () => ({}) },
      { name: 'device.info', invoke: async () => ({}) },
    ] })).toThrow('already registered');
    expect(registry.listAdapters()).toHaveLength(0);
    expect(registry.listCapabilities()).toHaveLength(0);
  });

  test('records lifecycle failures', async () => {
    const registry = new PlatformAdapterRegistry();
    registry.register({ id: 'host.runtime', start: async () => { throw new Error('boot failed'); }, capabilities: [{ name: 'device.info', invoke: async () => ({}) }] });
    await expect(registry.start('host.runtime')).rejects.toThrow('boot failed');
    expect(registry.describeAdapter('host.runtime')).toMatchObject({ state: 'failed', lastError: 'boot failed' });
  });

  test('stops a started adapter and makes its capabilities unavailable', async () => {
    const stop = jest.fn(async () => {});
    const registry = new PlatformAdapterRegistry();
    registry.register({ id: 'host.runtime', stop, capabilities: [{ name: 'device.info', invoke: async () => ({}) }] });
    await registry.start('host.runtime');
    await registry.stop('host.runtime');
    expect(stop).toHaveBeenCalledTimes(1);
    await expect(registry.invoke('platform.host.runtime.device.info')).rejects.toThrow('not ready');
  });
});
