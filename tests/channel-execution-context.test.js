import { buildChannelExecutionContext } from '../src/core/execution-context.js';

describe('channel execution context', () => {
  test('resolves an authorized roaming tenant/site/router selection', () => {
    const context = buildChannelExecutionContext({
      channel: 'telegram', userId: 'user-1', platformId: 'chat-1',
      tenantId: 'tenant-a', tenantIds: ['tenant-a', 'tenant-b'], siteIds: ['site-a'], nodeIds: ['router-a'],
      selection: { tenantId: 'tenant-a', siteId: 'site-a', nodeId: 'router-a', source: 'telegram-inline-keyboard' }
    });
    expect(context).toMatchObject({ activeTenantId: 'tenant-a', activeSiteId: 'site-a', activeNodeId: 'router-a', selectionSource: 'telegram-inline-keyboard' });
  });

  test('requires a selection when a channel user has multiple authorized sites', () => {
    expect(() => buildChannelExecutionContext({ channel: 'whatsapp', userId: 'user-1', tenantId: 'tenant-a', siteIds: ['site-a', 'site-b'] })).toThrow('active site selection is required');
  });
});
