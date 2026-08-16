const DEFAULT_CAPABILITIES = Object.freeze({
  buttons: true,
  inlineMenus: true,
  richCards: false,
  streaming: false,
  fileAttachments: false,
  voice: false,
  games: false,
});

const ROLE_PRIORITY = Object.freeze({
  owner: 100,
  admin: 80,
  operator: 60,
  partner: 50,
  analyst: 40,
  user: 10,
  guest: 0,
});

function normalizeList(value) {
  return Array.isArray(value) ? value.map((item) => String(item).toLowerCase()) : [];
}

function allowedRole(roles = []) {
  return normalizeList(roles).sort((a, b) => (ROLE_PRIORITY[b] || 0) - (ROLE_PRIORITY[a] || 0))[0] || 'user';
}

/**
 * Derive visible channel affordances from verified context only. This function
 * never infers authority from engagement, message count, location, or model
 * guesses. "Influence" is an explicit product/business signal, not a covert
 * ranking of the user.
 */
export function buildChannelUiPolicy(context = {}) {
  const role = allowedRole(context.roles || context.role);
  const status = String(context.status || context.userDoc?.status || 'active').toLowerCase();
  const influence = String(context.influenceTier || context.userDoc?.influenceTier || 'standard').toLowerCase();
  const practiceMode = Boolean(context.practiceMode || context.userDoc?.practiceMode);
  const channel = String(context.channel || 'unknown').toLowerCase();
  const capabilities = { ...DEFAULT_CAPABILITIES, ...(context.channelCapabilities || {}) };
  const authorizedCapabilities = new Set(normalizeList(context.authorizedCapabilities || context.capabilities));
  const can = (capability) => authorizedCapabilities.has(capability) || authorizedCapabilities.has('*');
  const restricted = ['disabled', 'suspended', 'banned', 'pending'].includes(status);
  const elevated = (ROLE_PRIORITY[role] || 0) >= ROLE_PRIORITY.operator;

  const actions = restricted
    ? ['account.status', 'support.contact']
    : ['help', 'context.show', 'context.clear'];

  if (!restricted) {
    actions.push('research.deep_search', 'assist.task');
    if (can('network.read') || can('surveillance.read') || can('fleet.read')) {
      actions.push('network.suggest', 'device.nearby.discover');
    }
  }
  if (!restricted && elevated) actions.push('operations.status', 'audit.own');
  if (!restricted && ['owner', 'admin'].includes(role)) actions.push('tenant.manage');
  if (!restricted && capabilities.games) actions.push('game.start');
  if (!restricted && practiceMode) actions.push('practice.explain', 'practice.simulate');
  if (!restricted && elevated && (can('network.write') || can('fleet.write'))) {
    actions.push('network.user.kick', 'network.user.disable');
  }

  return Object.freeze({
    channel,
    role,
    status,
    influenceTier: influence,
    practiceMode,
    restricted,
    capabilities,
    actions: [...new Set(actions)],
    showAdvanced: !restricted && elevated,
    requireApprovalForMutations: true,
    contextDisclosure: restricted ? 'minimal' : 'scoped',
  });
}

export function canRenderAction(policy, action) {
  return Boolean(policy && Array.isArray(policy.actions) && policy.actions.includes(action));
}

export default { buildChannelUiPolicy, canRenderAction };

export { ROLE_PRIORITY };

