/**
 * Phase 5 Br3eze service-agent contract.
 *
 * This module defines identity and lifecycle invariants only. It does not grant
 * authorization; callers must still pass the canonical execution context and
 * mutation/approval guards before changing tenant or device state.
 */

export const BR3EZE_SERVICE_PROVIDER_ID = 'br3eze-africa';
export const BR3EZE_CONTACT_SPECIALIST_ID = 'br3eze-code';
export const BR3EZE_SERVICE_AGENT_ROLE = 'br3eze-service-agent';

export const ONBOARDING_STATES = Object.freeze([
  'TENANT_CREATED',
  'SITE_CREATED',
  'DEVICE_CLAIMED',
  'DEVICE_DISCOVERED',
  'FINGERPRINT_CAPTURED',
  'IDENTITY_VERIFIED',
  'BASELINE_PREVIEWED',
  'APPROVAL_PENDING',
  'CONFIGURATION_APPLIED',
  'CONNECTIVITY_VERIFIED',
  'SITE_ACTIVATED',
  'MONITORING',
  'QUARANTINED',
  'FAILED'
]);

const NEXT_STATES = Object.freeze({
  TENANT_CREATED: ['SITE_CREATED', 'FAILED'],
  SITE_CREATED: ['DEVICE_CLAIMED', 'FAILED'],
  DEVICE_CLAIMED: ['DEVICE_DISCOVERED', 'FAILED'],
  DEVICE_DISCOVERED: ['FINGERPRINT_CAPTURED', 'QUARANTINED', 'FAILED'],
  FINGERPRINT_CAPTURED: ['IDENTITY_VERIFIED', 'QUARANTINED', 'FAILED'],
  IDENTITY_VERIFIED: ['BASELINE_PREVIEWED', 'QUARANTINED', 'FAILED'],
  BASELINE_PREVIEWED: ['APPROVAL_PENDING', 'FAILED'],
  APPROVAL_PENDING: ['CONFIGURATION_APPLIED', 'FAILED'],
  CONFIGURATION_APPLIED: ['CONNECTIVITY_VERIFIED', 'FAILED'],
  CONNECTIVITY_VERIFIED: ['SITE_ACTIVATED', 'FAILED'],
  SITE_ACTIVATED: ['MONITORING', 'FAILED'],
  MONITORING: [],
  QUARANTINED: ['FINGERPRINT_CAPTURED', 'FAILED'],
  FAILED: []
});

export function assertBr3ezeTenantContact(tenant = {}) {
  if (!tenant || typeof tenant !== 'object') throw new TypeError('tenant is required');
  if (tenant.contactSpecialistId !== BR3EZE_CONTACT_SPECIALIST_ID) {
    throw new Error(`tenant.contactSpecialistId must be ${BR3EZE_CONTACT_SPECIALIST_ID}`);
  }
  if (tenant.serviceProviderId !== BR3EZE_SERVICE_PROVIDER_ID) {
    throw new Error(`tenant.serviceProviderId must be ${BR3EZE_SERVICE_PROVIDER_ID}`);
  }
  return true;
}

export function createBr3ezeTenantContact({ tenantId, principalId, channelIdentityId = null, createdBy }) {
  if (!tenantId || !principalId || !createdBy) throw new TypeError('tenantId, principalId, and createdBy are required');
  return Object.freeze({
    tenantId,
    principalId,
    channelIdentityId,
    specialistId: BR3EZE_CONTACT_SPECIALIST_ID,
    specialistRole: BR3EZE_SERVICE_AGENT_ROLE,
    serviceProviderId: BR3EZE_SERVICE_PROVIDER_ID,
    createdBy
  });
}

export function canAdvanceOnboarding(fromState, toState) {
  return ONBOARDING_STATES.includes(fromState)
    && ONBOARDING_STATES.includes(toState)
    && NEXT_STATES[fromState].includes(toState);
}

export function assertOnboardingTransition({ fromState, toState, tenantId, siteId, principalId }) {
  if (!tenantId || !siteId || !principalId) throw new TypeError('tenantId, siteId, and principalId are required');
  if (!canAdvanceOnboarding(fromState, toState)) {
    throw new Error(`invalid onboarding transition: ${fromState} -> ${toState}`);
  }
  return Object.freeze({ fromState, toState, tenantId, siteId, principalId });
}

export function buildPairingContract({ onboardingSessionId, tenantId, siteId, channelIdentityId, expiresAt }) {
  if (!onboardingSessionId || !tenantId || !siteId || !channelIdentityId || !expiresAt) {
    throw new TypeError('onboardingSessionId, tenantId, siteId, channelIdentityId, and expiresAt are required');
  }
  return Object.freeze({
    onboardingSessionId,
    tenantId,
    siteId,
    channelIdentityId,
    expiresAt,
    singleUse: true,
    credentialPayload: null
  });
}

export default {
  BR3EZE_SERVICE_PROVIDER_ID,
  BR3EZE_CONTACT_SPECIALIST_ID,
  BR3EZE_SERVICE_AGENT_ROLE,
  ONBOARDING_STATES,
  assertBr3ezeTenantContact,
  createBr3ezeTenantContact,
  canAdvanceOnboarding,
  assertOnboardingTransition,
  buildPairingContract
};
