import crypto from 'node:crypto';
import {
  BR3EZE_CONTACT_SPECIALIST_ID,
  BR3EZE_SERVICE_PROVIDER_ID,
  buildPairingContract
} from './br3eze-service-agent.js';

export const ONBOARDING_SESSION_STATUS = Object.freeze({
  ACTIVE: 'active',
  PAIRED: 'paired',
  COMPLETED: 'completed',
  EXPIRED: 'expired',
  REVOKED: 'revoked'
});

function required(value, name) {
  if (value == null || value === '') throw new TypeError(`${name} is required`);
  return String(value);
}

function hashPairingToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generatePairingToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Persistence-neutral registry. A cloud repository can implement the same
 * get/set/delete surface and provide durable RLS-backed storage later.
 */
export class OnboardingSessionRegistry {
  constructor({ store = new Map(), now = () => new Date(), pairingTtlMs = 10 * 60 * 1000 } = {}) {
    this.store = store;
    this.now = now;
    this.pairingTtlMs = pairingTtlMs;
  }

  create({ tenantId, siteId, principalId, channelIdentityId, channel, createdBy, specialistId = BR3EZE_CONTACT_SPECIALIST_ID }) {
    required(tenantId, 'tenantId');
    required(siteId, 'siteId');
    required(principalId, 'principalId');
    required(channelIdentityId, 'channelIdentityId');
    required(channel, 'channel');
    required(createdBy, 'createdBy');
    if (specialistId !== BR3EZE_CONTACT_SPECIALIST_ID) throw new Error('onboarding must use the br3eze-code specialist');

    const onboardingSessionId = `onb_${crypto.randomUUID()}`;
    const pairingToken = generatePairingToken();
    const createdAtDate = this.now();
    const createdAt = createdAtDate.toISOString();
    const expiresAt = new Date(createdAtDate.getTime() + this.pairingTtlMs).toISOString();
    const session = {
      onboardingSessionId,
      serviceProviderId: BR3EZE_SERVICE_PROVIDER_ID,
      specialistId,
      tenantId: String(tenantId),
      siteId: String(siteId),
      principalId: String(principalId),
      channelIdentityId: String(channelIdentityId),
      channel: String(channel).toLowerCase(),
      createdBy: String(createdBy),
      status: ONBOARDING_SESSION_STATUS.ACTIVE,
      pairingTokenHash: hashPairingToken(pairingToken),
      pairingIssuedAt: createdAt,
      pairingExpiresAt: expiresAt,
      pairingRedeemedAt: null,
      pairedPrincipalId: null,
      createdAt,
      updatedAt: createdAt
    };
    this.store.set(onboardingSessionId, session);
    return {
      onboardingSession: clone(session),
      pairing: buildPairingContract({
        onboardingSessionId,
        tenantId: session.tenantId,
        siteId: session.siteId,
        channelIdentityId: session.channelIdentityId,
        expiresAt
      }),
      pairingToken
    };
  }

  get(onboardingSessionId) {
    const session = this.store.get(onboardingSessionId);
    return session ? clone(session) : null;
  }

  redeem({ onboardingSessionId, pairingToken, principalId }) {
    required(onboardingSessionId, 'onboardingSessionId');
    required(pairingToken, 'pairingToken');
    required(principalId, 'principalId');
    const session = this.store.get(onboardingSessionId);
    if (!session) throw new Error('onboarding session not found');
    if (session.status !== ONBOARDING_SESSION_STATUS.ACTIVE) throw new Error('onboarding session is not redeemable');
    if (session.pairingTokenHash !== hashPairingToken(pairingToken)) throw new Error('invalid pairing token');

    const redeemedAt = this.now().toISOString();
    session.status = ONBOARDING_SESSION_STATUS.PAIRED;
    session.pairedPrincipalId = String(principalId);
    session.pairingRedeemedAt = redeemedAt;
    session.updatedAt = redeemedAt;
    this.store.set(onboardingSessionId, session);
    return clone(session);
  }

  assertScope({ onboardingSessionId, tenantId, siteId, principalId }) {
    const session = this.store.get(onboardingSessionId);
    if (!session) throw new Error('onboarding session not found');
    if (session.tenantId !== String(tenantId) || session.siteId !== String(siteId)) {
      throw new Error('onboarding session scope mismatch');
    }
    const allowedPrincipal = session.principalId === String(principalId) || session.pairedPrincipalId === String(principalId);
    if (!allowedPrincipal) throw new Error('principal is not linked to onboarding session');
    return clone(session);
  }
}

export { hashPairingToken };
export default OnboardingSessionRegistry;
