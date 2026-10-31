import { afterEach, expect, jest, test } from '@jest/globals';

jest.unstable_mockModule('node-cache', () => ({
  default: class {
    get() { return undefined; }
    set() {}
    del() {}
    flushAll() {}
  }
}), { virtual: true });

const { MikroTikManager, registerNetworkProvider, clearNetworkProvider } = await import('../../src/core/mikrotik.js');

afterEach(() => clearNetworkProvider());

test('network facade fails clearly when no adapter is registered', async () => {
  clearNetworkProvider();
  const manager = new MikroTikManager();

  await expect(manager.connect()).rejects.toThrow('No network adapter registered');
});

test('network facade delegates to the registered provider', async () => {
  const provider = {
    connect: jest.fn().mockResolvedValue(true),
    disconnect: jest.fn().mockResolvedValue(true),
    executeTool: jest.fn().mockResolvedValue({ ok: true }),
  };
  registerNetworkProvider(provider);
  const manager = new MikroTikManager({ host: '10.0.0.1' });

  await expect(manager.connect()).resolves.toBe(true);
  await expect(manager.disconnect()).resolves.toBe(true);
  await expect(manager.executeTool('status')).resolves.toEqual({ ok: true });
  expect(provider.connect).toHaveBeenCalledTimes(1);
  expect(provider.disconnect).toHaveBeenCalledTimes(1);
  expect(provider.executeTool).toHaveBeenCalledWith('status');
});
