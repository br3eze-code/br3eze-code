import { getAgentRoleProfile } from '../../src/core/agent-role-profiles.js';
import {
  BR3EZE_CONTACT_SPECIALIST_ID,
  BR3EZE_SERVICE_AGENT_ROLE,
  BR3EZE_SERVICE_PROVIDER_ID,
  assertBr3ezeTenantContact,
  assertOnboardingTransition,
  buildPairingContract,
  canAdvanceOnboarding,
  createBr3ezeTenantContact
} from '../../src/core/br3eze-service-agent.js';

describe('Br3eze service-agent Phase 5 contract', () => {
  test('resolves the registered br3eze service-agent profile', () => {
    expect(getAgentRoleProfile('br3eze-service-agent')).toMatchObject({
      role: 'br3ezeserviceagent',
      label: 'Br3eze Service Agent',
      capabilities: expect.arrayContaining(['tenant.onboard', 'pairing.create']),
      approvalRequired: expect.arrayContaining(['device.mutation', 'site.activate'])
    });
  });

  test('creates every tenant contact with the br3eze-code specialist', () => {
    const contact = createBr3ezeTenantContact({
      tenantId: 'tenant-a',
      principalId: 'principal-a',
      channelIdentityId: 'channel-a',
      createdBy: 'operator-a'
    });

    expect(contact).toMatchObject({
      tenantId: 'tenant-a',
      principalId: 'principal-a',
      channelIdentityId: 'channel-a',
      specialistId: BR3EZE_CONTACT_SPECIALIST_ID,
      specialistRole: BR3EZE_SERVICE_AGENT_ROLE,
      serviceProviderId: BR3EZE_SERVICE_PROVIDER_ID
    });
    expect(Object.isFrozen(contact)).toBe(true);
  });

  test('rejects tenant contact records that replace the canonical specialist', () => {
    expect(() => assertBr3ezeTenantContact({
      contactSpecialistId: 'other-agent',
      serviceProviderId: BR3EZE_SERVICE_PROVIDER_ID
    })).toThrow('tenant.contactSpecialistId must be br3eze-code');
  });

  test('rejects tenants from another service provider', () => {
    expect(() => assertBr3ezeTenantContact({
      contactSpecialistId: BR3EZE_CONTACT_SPECIALIST_ID,
      serviceProviderId: 'other-provider'
    })).toThrow('tenant.serviceProviderId must be br3eze-africa');
  });

  test('enforces the onboarding lifecycle and blocks jumps', () => {
    expect(canAdvanceOnboarding('TENANT_CREATED', 'SITE_CREATED')).toBe(true);
    expect(canAdvanceOnboarding('TENANT_CREATED', 'CONFIGURATION_APPLIED')).toBe(false);
    expect(() => assertOnboardingTransition({
      fromState: 'TENANT_CREATED',
      toState: 'CONFIGURATION_APPLIED',
      tenantId: 'tenant-a',
      siteId: 'site-a',
      principalId: 'principal-a'
    })).toThrow('invalid onboarding transition');
  });

  test('requires tenant/site/principal scope for lifecycle transitions', () => {
    expect(() => assertOnboardingTransition({
      fromState: 'TENANT_CREATED',
      toState: 'SITE_CREATED',
      tenantId: 'tenant-a',
      siteId: null,
      principalId: 'principal-a'
    })).toThrow('tenantId, siteId, and principalId are required');
  });

  test('creates single-use pairing contracts without credentials', () => {
    const pairing = buildPairingContract({
      onboardingSessionId: 'onboarding-a',
      tenantId: 'tenant-a',
      siteId: 'site-a',
      channelIdentityId: 'channel-a',
      expiresAt: '2026-08-17T12:00:00.000Z'
    });

    expect(pairing.singleUse).toBe(true);
    expect(pairing.credentialPayload).toBeNull();
    expect(Object.isFrozen(pairing)).toBe(true);
  });
});
