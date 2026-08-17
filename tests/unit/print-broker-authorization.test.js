import { jest } from '@jest/globals';

const { PrintBroker } = await import('../../src/core/print-broker.js');

describe('PrintBroker authorization boundary', () => {
  let broker;

  beforeEach(() => {
    broker = new PrintBroker();
    broker.attachWebSocketChannel({
      clients: new Map([
        ['tenant-a-site-1', {
          ws: { id: 'a' },
          capabilities: { printer: 'ble' },
          authorityContext: {
            tenantId: 'tenant-a',
            siteId: 'site-1',
            capabilities: ['printer.write']
          }
        }],
        ['tenant-a-site-2', {
          ws: { id: 'b' },
          capabilities: { printer: 'usb' },
          authorityContext: {
            tenantId: 'tenant-a',
            siteId: 'site-2',
            capabilities: ['printer.write']
          }
        }],
        ['tenant-b-site-1', {
          ws: { id: 'c' },
          capabilities: { printer: 'ble' },
          authorityContext: {
            tenantId: 'tenant-b',
            siteId: 'site-1',
            capabilities: ['printer.write']
          }
        }]
      ]),
      sendToWs: jest.fn()
    });
  });

  afterEach(() => {
    broker.pending.clear();
  });

  test('requires tenant and site scope before exposing mobile printer clients', () => {
    expect(broker.getMobileClientStatus()).toMatchObject({ count: 0, reason: 'print_scope_required' });
    expect(broker.getMobileClientStatus({ tenantId: 'tenant-a', siteId: 'site-1' }).clients)
      .toEqual([{ clientId: 'tenant-a-site-1', platform: 'android', model: null, capability: 'ble' }]);
  });

  test('does not expose another tenant or site printer', () => {
    const result = broker.getMobileClientStatus({ tenantId: 'tenant-a', siteId: 'site-2' });
    expect(result.clients.map(client => client.clientId)).toEqual(['tenant-a-site-2']);
    expect(result.clients.map(client => client.clientId)).not.toContain('tenant-b-site-1');
  });

  test('ignores an acknowledgement from a different client', async () => {
    let resolve;
    const settled = new Promise(r => { resolve = r; });
    broker.pending.set('job-1', {
      clientId: 'tenant-a-site-1',
      timer: setTimeout(() => {}, 1000),
      resolve: () => resolve('resolved'),
      reject: () => resolve('rejected')
    });

    broker._handleMobileAck({ jobId: 'job-1', clientId: 'tenant-b-site-1', success: true });
    expect(broker.pending.has('job-1')).toBe(true);

    broker._handleMobileAck({ jobId: 'job-1', clientId: 'tenant-a-site-1', success: true });
    await expect(settled).resolves.toBe('resolved');
    expect(broker.pending.has('job-1')).toBe(false);
  });
});

afterAll(() => {
  jest.restoreAllMocks();
});
