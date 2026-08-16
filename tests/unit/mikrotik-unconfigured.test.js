import { jest } from '@jest/globals';

const connectSpy = jest.fn(() => Promise.reject(new Error('should not connect')));

jest.unstable_mockModule('routeros-client', () => ({
  RouterOSClient: class {
    connect(...args) { return connectSpy(...args); }
  }
}), { virtual: true });

jest.unstable_mockModule('node-cache', () => ({
  default: class {
    get() { return undefined; }
    set() {}
    del() {}
    flushAll() {}
  }
}), { virtual: true });

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.unstable_mockModule('../../src/core/logger.js', () => ({ logger }));
jest.unstable_mockModule('../../src/core/config.js', () => ({ getConfig: () => ({}) }));

const { MikroTikManager } = await import('../../src/core/mikrotik.js');

test('unconfigured MikroTik remains silent and does not connect', async () => {
  const manager = new MikroTikManager();

  expect(manager.isConfigured).toBe(false);
  await expect(manager.connect()).resolves.toBe(false);
  expect(connectSpy).not.toHaveBeenCalled();
  expect(logger.info).not.toHaveBeenCalled();
  expect(logger.warn).not.toHaveBeenCalled();
  expect(logger.error).not.toHaveBeenCalled();
});

 test('configured-but-disconnected billing state remains distinguishable', () => {
  const configured = new MikroTikManager({ host: '10.0.0.1' });
  expect(configured.isConfigured).toBe(true);
});
