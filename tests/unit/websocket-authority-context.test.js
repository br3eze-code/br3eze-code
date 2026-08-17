import { jest } from '@jest/globals';
import WebSocketChannel from '../../src/core/channels/WebSocketChannel.js';

describe('WebSocket trusted authorityContext bridge', () => {
  function createChannel(authorityContext) {
    const sent = [];
    const ws = { readyState: 1, send: (payload) => sent.push(JSON.parse(payload)) };
    const db = {
      resolveFirebaseUser: jest.fn(async () => ({ uid: 'uid-roaming-user', email: 'user@example.com' })),
      resolveAuthorityContext: jest.fn(async () => authorityContext)
    };
    const channel = new WebSocketChannel({ server: null }, { database: db });
    channel.clients.set('ws-client-1', { ws, authenticated: true });
    return { channel, db, sent };
  }

  test('derives tenant, site, router, role, and capability scope from the server resolver', async () => {
    const { channel, db, sent } = createChannel({
      tenantId: 'tenant-a',
      siteIds: ['site-a-1', 'site-a-2'],
      routerIds: ['router-a-1', 'router-a-2'],
      siteId: 'site-a-2',
      routerId: 'router-a-2',
      roles: ['site-operator'],
      capabilities: ['printer.write', 'router.health.read']
    });

    await channel.handleLegacyMessage('ws-client-1', {
      type: 'auth.identify',
      uid: 'uid-roaming-user',
      clientId: 'not-a-valid-client-id'
    });

    const client = channel.clients.get('ws-client-1');
    expect(db.resolveAuthorityContext).toHaveBeenCalledWith('uid-roaming-user');
    expect(client.authorityContext).toEqual(expect.objectContaining({
      source: 'server-membership',
      userId: 'uid-roaming-user',
      tenantId: 'tenant-a',
      siteId: 'site-a-2',
      routerId: 'router-a-2',
      authorizedSiteIds: ['site-a-1', 'site-a-2'],
      authorizedRouterIds: ['router-a-1', 'router-a-2']
    }));
    expect(sent.at(-1)).toEqual(expect.objectContaining({
      type: 'auth.identified',
      authorityContext: expect.objectContaining({ tenantId: 'tenant-a', siteId: 'site-a-2' })
    }));
  });

  test('does not accept client-supplied tenant or site scope when the server has no authority record', async () => {
    const { channel, sent } = createChannel(null);

    await channel.handleLegacyMessage('ws-client-1', {
      type: 'auth.identify',
      uid: 'uid-roaming-user',
      tenantId: 'tenant-attacker',
      siteId: 'site-attacker'
    });

    expect(channel.clients.get('ws-client-1').authorityContext).toBeUndefined();
    expect(sent.at(-1)).toEqual({ type: 'auth.rejected', code: 'TENANT_AUTHORITY_REQUIRED' });
  });

  test('rejects a server context whose active site or router is outside the authorized lists', () => {
    const channel = new WebSocketChannel({ server: null }, { database: {} });

    expect(channel._normalizeAuthorityContext({
      tenantId: 'tenant-a',
      siteId: 'site-b',
      authorizedSiteIds: ['site-a'],
      routerId: 'router-b',
      authorizedRouterIds: ['router-a']
    }, 'uid-roaming-user')).toBeNull();
  });
});
