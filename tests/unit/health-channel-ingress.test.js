import { HealthChannelIngress, parseTelegramHealthUpdate } from '../../src/core/health/health-channel-ingress.js';

describe('Telegram health channel ingress', () => {
  const update = (text = '/health tenant=tenant-a site=site-a1 router=router-a1') => ({
    update_id: 100,
    message: { text, from: { id: 77 }, chat: { id: -88 } }
  });

  test('maps explicit health commands to typed selectors without treating chat id as tenant id', () => {
    expect(parseTelegramHealthUpdate(update())).toMatchObject({
      source: 'telegram',
      channelIdentityId: 'telegram:-88',
      telegramUserId: '77',
      tenantId: 'tenant-a',
      siteIds: ['site-a1'],
      routerIds: ['router-a1'],
      capability: 'router.health.read'
    });
  });

  test('rejects arbitrary text and unsupported selectors', () => {
    expect(() => parseTelegramHealthUpdate(update('check everything'))).toThrow('unsupported Telegram command');
    expect(() => parseTelegramHealthUpdate(update('/health intent=cli'))).toThrow('unsupported health selector');
  });

  test('deduplicates Telegram updates before creating AgentOS work', async () => {
    const queued = [];
    const ingress = new HealthChannelIngress({
      resolvePrincipal: async () => ({ principalId: 'principal-a' }),
      enqueueWork: async (work) => queued.push(work),
      idFactory: () => 'fixed-id'
    });
    await expect(ingress.accept(update())).resolves.toMatchObject({ status: 'accepted', workId: 'work_fixed-id' });
    await expect(ingress.accept(update())).resolves.toMatchObject({ status: 'duplicate', updateId: '100' });
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ principalId: 'principal-a', capability: 'router.health.read', source: 'telegram' });
  });
});
