import { buildChannelUiPolicy } from './channel-ui-policy.js';

const CHANNEL_ID_FIELDS = {
  telegram: ['from.id', 'chat.id', 'user.id'],
  whatsapp: ['key.participant', 'key.remoteJid', 'sender', 'from'],
  discord: ['author.id', 'user.id', 'member.user.id'],
  slack: ['user', 'user_id', 'event.user', 'body.user_id'],
  web: ['auth.uid', 'user.uid', 'user.id', 'uid'],
  desktop: ['auth.uid', 'user.uid', 'user.id', 'uid'],
};

function readPath(value, path) {
  return path.split('.').reduce((current, key) => current == null ? undefined : current[key], value);
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function asString(value) {
  return value == null ? null : String(value);
}

function normalizeRoles(...roleSources) {
  const roles = roleSources.flatMap((source) => Array.isArray(source) ? source : [source]);
  return [...new Set(roles.filter(Boolean).map((role) => String(role).trim().toLowerCase()))];
}

/**
 * Extract the transport-specific identifier without treating it as the
 * canonical account identity. This is intentionally pure and safe to use in
 * adapters before database/OAuth resolution is available.
 */
export function getChannelIdentifier(channel, message = {}) {
  const normalized = String(channel || '').toLowerCase();
  const fields = CHANNEL_ID_FIELDS[normalized] || ['userId', 'uid', '_uid', 'id', 'user.id', 'author.id'];
  return asString(firstValue(...fields.map((field) => readPath(message, field))));
}

export function normalizeProviderIdentities(input = {}, userDoc = {}) {
  const source = {
    ...(userDoc.providerIdentities || {}),
    ...(userDoc.providers || {}),
    ...(input.providerIdentities || {}),
    ...(input.providers || {}),
  };
  for (const [provider, value] of Object.entries(source)) {
    if (value && typeof value === 'object') source[provider] = firstValue(value.sub, value.id, value.uid, value.subject, value.email) || null;
  }
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)]));
}

/**
 * Build the shared context consumed by tools, ask-engine, shopping, and
 * channel adapters. `location` is only copied from trusted caller/profile
 * input; it is never inferred from an IP, phone number, or channel.
 */
export function buildExecutionContext(input = {}) {
  const message = input.message || input.msg || {};
  const userDoc = input.userDoc || message.userDoc || {};
  const channel = String(firstValue(input.channel, message.channel, input.platform, userDoc.platform, 'unknown')).toLowerCase();
  const platformId = asString(firstValue(input.platformId, message.platformId, getChannelIdentifier(channel, message)));
  const canonicalUserId = asString(firstValue(
    input.userId,
    input.uid,
    input._uid,
    message.userId,
    message.uid,
    message._uid,
    userDoc.uid,
    userDoc.id,
    platformId,
  ));
  const roles = normalizeRoles(input.roles, input.role, message.roles, message.role, userDoc.roles, userDoc.role);
  const config = input.config || {};
  const location = input.location ?? message.location ?? userDoc.location ?? null;
  const address = input.address ?? message.address ?? userDoc.address ?? null;
  const timezone = firstValue(input.timezone, message.timezone, userDoc.timezone, config.timezone, process.env.TZ, 'UTC');
  const country = firstValue(input.country, message.country, userDoc.country, config.country, process.env.AGENTOS_DEFAULT_COUNTRY, null);
  const device = firstValue(input.device, input.deviceModel, message.device, message.deviceModel, userDoc.deviceModel, 'unknown');
  const scopes = input.scopes || message.scopes || userDoc.scopes || {};
  const tenantId = asString(firstValue(input.tenantId, input.tenant, message.tenantId, userDoc.tenantId, scopes.tenantId));
  const siteId = asString(firstValue(input.siteId, message.siteId, userDoc.siteId, scopes.siteId));
  const domain = String(firstValue(input.domain, message.domain, userDoc.domain, scopes.domain, config.domain, 'general'));
  const status = String(firstValue(input.status, message.status, userDoc.status, 'active')).toLowerCase();
  const influenceTier = String(firstValue(input.influenceTier, message.influenceTier, userDoc.influenceTier, 'standard')).toLowerCase();
  const consent = input.consent || message.consent || userDoc.consent || {};
  const oauth = input.oauth || message.oauth || null;
  const approval = input.approval || message.approval || null;
  const approvalGranted = Boolean(input.approvalGranted || message.approvalGranted);
  const research = input.research || message.research || null;
  const allowedDomains = Array.isArray(input.allowedDomains) ? input.allowedDomains : (Array.isArray(userDoc.allowedDomains) ? userDoc.allowedDomains : []);
  const authorizedSiteIds = Array.isArray(input.authorizedSiteIds) ? input.authorizedSiteIds : (Array.isArray(userDoc.authorizedSiteIds) ? userDoc.authorizedSiteIds : []);
  const authorizedCapabilities = Array.isArray(input.authorizedCapabilities)
    ? input.authorizedCapabilities
    : (Array.isArray(userDoc.authorizedCapabilities) ? userDoc.authorizedCapabilities : []);

  return {
    userId: canonicalUserId,
    uid: canonicalUserId,
    _uid: canonicalUserId,
    providerIdentities: normalizeProviderIdentities(input, userDoc),
    channel,
    platformId,
    channelIds: {
      ...(userDoc.channels || {}),
      ...(input.channelIds || {}),
      ...(platformId ? { [channel]: platformId } : {}),
    },
    conversationId: asString(firstValue(input.conversationId, message.conversationId, message.threadId, platformId)),
    roles,
    role: roles[0] || 'user',
    tenantId,
    siteId,
    domain,
    status,
    influenceTier,
    consent,
    oauth,
    approval,
    approvalGranted,
    research,
    scopes: { tenantId, siteId, domain, allowedDomains, authorizedSiteIds },
    allowedDomains,
    authorizedSiteIds,
    authorizedCapabilities,
    uiPolicy: buildChannelUiPolicy({ channel, roles, role: roles[0], status, influenceTier, practiceMode: input.practiceMode || message.practiceMode || userDoc.practiceMode, channelCapabilities: input.channelCapabilities, authorizedCapabilities }),
    country: country == null ? null : String(country),
    timezone: String(timezone),
    device: String(device),
    deviceModel: String(device),
    location,
    address,
    userDoc,
    auth: input.auth || message.auth || null,
    paymentConfig: input.paymentConfig || config.payment || {},
    source: input.source || 'channel',
  };
}

export function withExecutionContext(context, patch = {}) {
  return buildExecutionContext({ ...context, ...patch, userDoc: patch.userDoc || context?.userDoc });
}

export default { buildExecutionContext, withExecutionContext, getChannelIdentifier, normalizeProviderIdentities };
