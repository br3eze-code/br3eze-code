import { OnboardingSessionRegistry } from '../../src/core/onboarding-session-registry.js';

describe('OnboardingSessionRegistry', () => {
  const fixedNow = new Date('2026-08-17T10:00:00.000Z');

  function createRegistry() {
    return new OnboardingSessionRegistry({
      now: () => new Date(fixedNow),
      pairingTtlMs: 60_000
    });
  }

  test('creates a tenant-scoped pairing without storing the raw token', () => {
    const result = createRegistry().create({
      tenantId: 'tenant-a',
      siteId: 'site-a',
      principalId: 'principal-a',
      channelIdentityId: 'wa:+263771234567',
      channel: 'WhatsApp',
      createdBy: 'br3eze-operator'
    });

    expect(result.onboardingSession.specialistId).toBe('br3eze-code');
    expect(result.onboardingSession.pairingTokenHash).not.toBe(result.pairingToken);
    expect(result.pairing.expiresAt).toBe('2026-08-17T10:01:00.000Z');
    expect(result.pairing.credentialPayload).toBeNull();
  });

  test('redeems a pairing token once and links the Power Connect principal', () => {
    const registry = createRegistry();
    const created = registry.create({
      tenantId: 'tenant-a',
      siteId: 'site-a',
      principalId: 'channel-principal-a',
      channelIdentityId: 'telegram:100',
      channel: 'telegram',
      createdBy: 'br3eze-operator'
    });

    const redeemed = registry.redeem({
      onboardingSessionId: created.onboardingSession.onboardingSessionId,
      pairingToken: created.pairingToken,
      principalId: 'power-connect-principal-a'
    });

    expect(redeemed.status).toBe('paired');
    expect(redeemed.pairedPrincipalId).toBe('power-connect-principal-a');
    expect(() => registry.redeem({
      onboardingSessionId: created.onboardingSession.onboardingSessionId,
      pairingToken: created.pairingToken,
      principalId: 'another-principal'
    })).toThrow('not redeemable');
  });

  test('rejects invalid token and cross-tenant or cross-site scope', () => {
    const registry = createRegistry();
    const created = registry.create({
      tenantId: 'tenant-a',
      siteId: 'site-a',
      principalId: 'principal-a',
      channelIdentityId: 'wa:100',
      channel: 'whatsapp',
      createdBy: 'br3eze-operator'
    });

    expect(() => registry.redeem({
      onboardingSessionId: created.onboardingSession.onboardingSessionId,
      pairingToken: 'wrong-token',
      principalId: 'principal-a'
    })).toThrow('invalid pairing token');
    expect(() => registry.assertScope({
      onboardingSessionId: created.onboardingSession.onboardingSessionId,
      tenantId: 'tenant-b',
      siteId: 'site-a',
      principalId: 'principal-a'
    })).toThrow('scope mismatch');
    expect(() => registry.assertScope({
      onboardingSessionId: created.onboardingSession.onboardingSessionId,
      tenantId: 'tenant-a',
      siteId: 'site-a',
      principalId: 'unlinked-principal'
    })).toThrow('not linked');
  });
});
