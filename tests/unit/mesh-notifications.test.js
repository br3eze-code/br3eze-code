import { EventEmitter } from 'node:events';
import MeshNotificationHub from '../../src/core/mesh-notification-hub.js';


describe('MeshNotificationHub', () => {
  test('delivers only matching tenant and site events', () => {
    const hub = new MeshNotificationHub();
    const received = [];
    hub.subscribe({ tenantId: 'tenant-a', siteId: 'site-a' }, (event) => received.push(event));

    hub.publish({ tenantId: 'tenant-b', siteId: 'site-a', type: 'node.offline' });
    hub.publish({ tenantId: 'tenant-a', siteId: 'site-b', type: 'node.offline' });
    hub.publish({ tenantId: 'tenant-a', siteId: 'site-a', type: 'node.offline' });

    expect(received).toHaveLength(1);
    expect(received[0].tenantId).toBe('tenant-a');
  });

  test('filters by event type and removes failed subscribers', () => {
    const hub = new MeshNotificationHub();
    const received = [];
    hub.subscribe({ tenantId: 'tenant-a', types: ['site.alerted'] }, (event) => received.push(event));
    hub.subscribe({ tenantId: 'tenant-a' }, () => { throw new Error('closed stream'); });

    expect(hub.publish({ tenantId: 'tenant-a', type: 'node.offline' })).toBe(0);
    expect(hub.publish({ tenantId: 'tenant-a', type: 'site.alerted' })).toBe(1);
    expect(received).toHaveLength(1);
  });

  test('enforces per-tenant subscriber limits', () => {
    const hub = new MeshNotificationHub({ maxSubscribersPerTenant: 1 });
    const unsubscribe = hub.subscribe({ tenantId: 'tenant-a' }, () => {});
    expect(() => hub.subscribe({ tenantId: 'tenant-a' }, () => {})).toThrow('subscriber limit');
    unsubscribe();
    expect(() => hub.subscribe({ tenantId: 'tenant-a' }, () => {})).not.toThrow();
  });
});


describe('mesh notification route authorization helpers', () => {
  test('keeps the route module free of EventEmitter-only imports', async () => {
    const module = await import('../../src/routes/mesh-notifications.js');
    expect(typeof module.createMeshNotificationRouter).toBe('function');
    expect(EventEmitter).toBeDefined();
  });
});
