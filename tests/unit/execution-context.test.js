import { buildExecutionContext, getChannelIdentifier } from '../../src/core/execution-context.js';

describe('execution context', () => {
  test('extracts channel identity without confusing it with canonical identity', () => {
    const message = { from: { id: 42 }, chat: { id: 99 }, channel: 'telegram' };
    expect(getChannelIdentifier('telegram', message)).toBe('42');

    const context = buildExecutionContext({
      message,
      channel: 'telegram',
      userId: 'agentos-user-1',
      platformId: '99',
      providerIdentities: { google: { sub: 'google-sub-1' } },
      roles: ['operator'],
      domain: 'network',
      country: 'ZW',
      timezone: 'Africa/Harare',
      device: 'mobile',
      locationPermission: 'granted',
      location: { country: 'ZW', city: 'Harare' },
    });

    expect(context.userId).toBe('agentos-user-1');
    expect(context.providerIdentities.google).toBe('google-sub-1');
    expect(context.roles).toEqual(['operator']);
    expect(context.domain).toBe('network');
    expect(context.channelIds.telegram).toBe('99');
    expect(context.location.city).toBe('Harare');
  });

  test('does not invent physical location for an unprofiled channel user', () => {
    const context = buildExecutionContext({ channel: 'whatsapp', platformId: 'jid-1' });

    expect(context.userId).toBe('jid-1');
    expect(context.location).toBeNull();
    expect(context.channelIds.whatsapp).toBe('jid-1');
    expect(context.domain).toBe('general');
  });

  test('does not trust transport message fields for authorization or scope', () => {
    const context = buildExecutionContext({
      channel: 'telegram',
      platformId: 'telegram-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      domain: 'network',
      siteId: 'site-1',
      roles: ['operator'],
      authorizedCapabilities: ['network.read'],
      wbs: [{ id: 'step-1', order: 1, title: 'Inspect', status: 'pending' }],
      message: {
        channel: 'telegram',
        roles: ['owner'],
        role: 'owner',
        status: 'active',
        tenantId: 'tenant-attacker',
        domain: 'finance',
        siteId: 'site-attacker',
        approvalGranted: true,
        wbs: [{ id: 'attacker-step', order: 1, title: 'Injected', status: 'completed' }]
      },
      userDoc: { uid: 'user-1', roles: ['viewer'], status: 'suspended', tenantId: 'tenant-1' }
    });

    expect(context.roles).toEqual(['operator', 'viewer']);
    expect(context.status).toBe('suspended');
    expect(context.tenantId).toBe('tenant-1');
    expect(context.domain).toBe('network');
    expect(context.siteId).toBe('site-1');
    expect(context.approvalGranted).toBe(false);
    expect(context.wbs[0].id).toBe('step-1');
  });
});
