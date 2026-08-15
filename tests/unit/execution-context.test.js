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
});
