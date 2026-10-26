import { describe, expect, test, jest } from '@jest/globals';
import { ServiceSupervisor } from '../../src/core/os/ServiceSupervisor.js';
import { IPCMessageBus } from '../../src/core/os/IPCMessageBus.js';
import { ApplicationManager } from '../../src/core/os/ApplicationManager.js';

describe('Br3eze OS managed application platform', () => {
  test('supervises service lifecycle and records failures', async () => {
    const start = jest.fn(async () => {});
    const stop = jest.fn(async () => {});
    const supervisor = new ServiceSupervisor();
    supervisor.register({ id: 'demo.service', start, stop });
    await supervisor.start('demo.service');
    await supervisor.start('demo.service');
    expect(start).toHaveBeenCalledTimes(1);
    expect(supervisor.describe('demo.service').state).toBe('running');
    await supervisor.stop('demo.service');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(supervisor.describe('demo.service').state).toBe('stopped');
  });

  test('rejects ungranted IPC and isolates delivery by tenant', async () => {
    const bus = new IPCMessageBus();
    const received = jest.fn();
    bus.subscribe({ topic: 'demo.events', subscriberId: 'app-a', tenantId: 'tenant-a', userId: 'user-a', authorizedTopics: ['demo.events'] }, received);
    await expect(bus.publish({ topic: 'demo.events', publisherId: 'app-b', tenantId: 'tenant-a', userId: 'user-a' }, { value: 1 })).rejects.toThrow('missing_permission');
    await bus.publish({ topic: 'demo.events', publisherId: 'app-b', tenantId: 'tenant-b', userId: 'user-b', authorizedTopics: ['demo.events'] }, { value: 2 });
    expect(received).not.toHaveBeenCalled();
    await bus.publish({ topic: 'demo.events', publisherId: 'app-b', tenantId: 'tenant-a', userId: 'user-a', authorizedTopics: ['demo.events'] }, { value: 3 });
    expect(received).toHaveBeenCalledTimes(1);
    expect(received.mock.calls[0][0].payload).toEqual({ value: 3 });
  });

  test('rejects unsafe IPC payloads', async () => {
    const bus = new IPCMessageBus();
    await expect(bus.publish({ topic: 'demo.events', publisherId: 'app', tenantId: 'tenant', userId: 'user', authorizedTopics: ['demo.events'] }, { bad: () => {} })).rejects.toThrow('JSON-compatible');
  });

  test('registers and manages apps through the service supervisor', async () => {
    const supervisor = new ServiceSupervisor();
    const start = jest.fn(async () => {});
    const stop = jest.fn(async () => {});
    const apps = new ApplicationManager({ supervisor });
    apps.register({ id: 'demo.app', version: '1.0.0', entryService: 'demo.service', permissions: ['ipc.publish:demo.events'] }, { id: 'demo.service', start, stop });
    await apps.start('demo.app', { tenantId: 'tenant-a', userId: 'user-a' });
    expect(apps.describe('demo.app').state).toBe('running');
    expect(start).toHaveBeenCalledTimes(1);
    await apps.stop('demo.app');
    expect(apps.describe('demo.app').state).toBe('stopped');
  });

  test('rejects invalid manifests and mismatched services', () => {
    const apps = new ApplicationManager({ supervisor: new ServiceSupervisor() });
    expect(() => apps.register({ id: 'bad app', version: '1.0.0', entryService: 'svc' }, { id: 'svc', start() {}, stop() {} })).toThrow('manifest.id');
    expect(() => apps.register({ id: 'demo.app', version: '1.0.0', entryService: 'svc' }, { id: 'other', start() {}, stop() {} })).toThrow('must match');
  });
});
