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
    const bus = new IPCMessageBus({ authorize: ({ action, topic, tenantId }) => topic === 'demo.events' && action === 'subscribe' ? tenantId === 'tenant-a' : topic === 'demo.events' && tenantId === 'tenant-a' });
    const received = jest.fn();
    await bus.subscribe({ topic: 'demo.events', subscriberId: 'app-a', tenantId: 'tenant-a', userId: 'user-a', authorizedTopics: ['demo.events'] }, received);
    const auditEvents = [];
    const deniedBus = new IPCMessageBus({ onAudit: (event) => auditEvents.push(event) });
    await expect(deniedBus.publish({ topic: 'demo.events', publisherId: 'app-b', tenantId: 'tenant-a', userId: 'user-a', authorizedTopics: ['demo.events'] }, { value: 1 })).rejects.toThrow('missing_permission');
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].type).toBe('ipc.authorization.denied');
    await expect(bus.publish({ topic: 'demo.events', publisherId: 'app-b', tenantId: 'tenant-b', userId: 'user-b' }, { value: 2 })).rejects.toThrow('missing_permission');
    expect(received).not.toHaveBeenCalled();
    await bus.publish({ topic: 'demo.events', publisherId: 'app-b', tenantId: 'tenant-a', userId: 'user-a' }, { value: 3 });
    expect(received).toHaveBeenCalledTimes(1);
    expect(received.mock.calls[0][0].payload).toEqual({ value: 3 });
  });

  test('rejects unsafe IPC payloads', async () => {
    const bus = new IPCMessageBus({ authorize: () => true });
    await expect(bus.publish({ topic: 'demo.events', publisherId: 'app', tenantId: 'tenant', userId: 'user', authorizedTopics: ['demo.events'] }, { bad: () => {} })).rejects.toThrow('JSON-compatible');
  });

  test('rejects IPC payloads exceeding byte limits', async () => {
    const bus = new IPCMessageBus({ maxPayloadBytes: 32, authorize: () => true });
    await expect(bus.publish({ topic: 'demo.events', publisherId: 'app', tenantId: 'tenant', userId: 'user' }, { value: 'x'.repeat(100) })).rejects.toThrow('byte limit');
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

  test('records failed application startup instead of leaving a stale installed state', async () => {
    const apps = new ApplicationManager({ supervisor: new ServiceSupervisor() });
    apps.register({ id: 'broken.app', version: '1.0.0', entryService: 'broken.service' }, {
      id: 'broken.service', start: async () => { throw new Error('startup failed'); }, stop: async () => {},
    });
    await expect(apps.start('broken.app')).rejects.toThrow('startup failed');
    expect(apps.describe('broken.app').state).toBe('failed');
  });

  test('rejects invalid manifests and mismatched services', () => {
    const apps = new ApplicationManager({ supervisor: new ServiceSupervisor() });
    expect(() => apps.register({ id: 'bad app', version: '1.0.0', entryService: 'svc' }, { id: 'svc', start() {}, stop() {} })).toThrow('manifest.id');
    expect(() => apps.register({ id: 'demo.app', version: '1.0.0', entryService: 'svc' }, { id: 'other', start() {}, stop() {} })).toThrow('must match');
  });
});
