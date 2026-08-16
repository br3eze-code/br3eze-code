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
  cashier: 55,
  partner: 50,
  analyst: 40,
  user: 10,
  guest: 0,
});

function normalizeList(value) {
  return Array.isArray(value) ? value.map(item => String(item).toLowerCase()) : [];
}

function allowedRole(roles = []) {
  return (
    normalizeList(roles).sort((a, b) => (ROLE_PRIORITY[b] || 0) - (ROLE_PRIORITY[a] || 0))[0] ||
    'user'
  );
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
  const influence = String(
    context.influenceTier || context.userDoc?.influenceTier || 'standard'
  ).toLowerCase();
  const practiceMode = Boolean(context.practiceMode || context.userDoc?.practiceMode);
  const channel = String(context.channel || 'unknown').toLowerCase();
  const capabilities = { ...DEFAULT_CAPABILITIES, ...(context.channelCapabilities || {}) };
  const authorizedCapabilities = new Set(
    normalizeList(context.authorizedCapabilities || context.capabilities)
  );
  const locationPermission =
    context.locationPermission === true ||
    ['true', 'granted', 'allowed', 'precise', 'approximate'].includes(
      String(context.locationPermission || context.consent?.location || '').toLowerCase()
    );
  const can = capability =>
    authorizedCapabilities.has(capability) || authorizedCapabilities.has('*');
  const canDiscoverNearby =
    locationPermission && (can('device.nearby.discover') || can('iot.device.discover'));
  const restricted = ['disabled', 'suspended', 'banned', 'pending'].includes(status);
  const elevated = (ROLE_PRIORITY[role] || 0) >= ROLE_PRIORITY.operator;

  const actions = restricted
    ? ['account.status', 'support.contact']
    : ['help', 'context.show', 'context.clear'];

  if (!restricted) {
    actions.push('research.deep_search', 'assist.task', 'assist.next_action');
    if (can('network.read') || can('surveillance.read') || can('fleet.read')) {
      actions.push('network.suggest');
    }
    if (canDiscoverNearby) actions.push('device.nearby.discover');
  }
  const agentRole = String(context.agentRole || context.professionalRole || '').toLowerCase();
  const tierRank = { guest: 0, standard: 1, partner: 2, pro: 3, enterprise: 4, admin: 5, owner: 6 };
  const tier = String(
    context.influenceTier || context.userDoc?.influenceTier || 'standard'
  ).toLowerCase();
  if (!restricted && elevated) actions.push('operations.status', 'audit.own');
  if (
    !restricted &&
    [
      'planner',
      'engineer',
      'accountant',
      'secretary',
      'procurement',
      'expeditor',
      'designer',
      'draftsman',
      'qa',
    ].includes(agentRole)
  ) {
    actions.push('team.work_queue', 'team.submit_evidence', 'team.next_action', 'team.activity_chart', 'team.specialist_detail');
  }
  if (
    !restricted &&
    ['partner', 'pro', 'enterprise', 'admin', 'owner'].includes(tier) &&
    (tierRank[tier] || 0) >= tierRank.partner
  ) {
    actions.push('team.progress', 'team.commission_summary');
  }
  if (!restricted && ['pro', 'enterprise', 'admin', 'owner'].includes(tier))
    actions.push('team.evidence.detail');
  if (!restricted && ['admin', 'owner'].includes(tier))
    actions.push('team.commission.approve', 'team.assignment.manage');
  if (!restricted && role === 'cashier')
    actions.push(
      'pos.new_sale',
      'pos.held_sales',
      'pos.payment_status',
      'pos.receipt',
      'pos.shift'
    );
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
