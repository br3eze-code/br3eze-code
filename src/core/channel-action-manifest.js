import { buildChannelUiPolicy, canRenderAction } from './channel-ui-policy.js';

const ACTIONS = Object.freeze({
  help: { label: 'Help', prompt: 'Show me what you can do.' },
  'context.show': { label: 'Show context', prompt: 'Show my current scoped context.' },
  'context.clear': {
    label: 'Clear context',
    prompt: 'Clear only my current conversation context.',
  },
  'research.deep_search': { label: 'Deep search', prompt: null },
  'assist.task': { label: 'Assist with a task', prompt: null },
  'assist.next_action': {
    label: 'Suggest next step',
    prompt: 'Suggest the safest next step for my current task.',
  },
  'assist.continue': { label: 'Continue task', prompt: 'Continue the current authorized task.' },
  'assist.clarify': {
    label: 'Clarify task',
    prompt: 'Ask me only the most important clarification needed to continue.',
  },
  'assist.prepare': {
    label: 'Prepare preview',
    prompt: 'Prepare a read-only preview of the next step.',
  },
  'assist.approve': { label: 'Approve action', prompt: null },
  'assist.verify': {
    label: 'Verify result',
    prompt: 'Verify the current task result and update progress.',
  },
  'network.suggest': {
    label: 'Network suggestions',
    prompt: 'Suggest safe network actions for my current authorized scope.',
  },
  'device.nearby.discover': {
    label: 'Nearby devices',
    prompt: 'Discover nearby devices within my authorized scope.',
  },
  'operations.status': {
    label: 'Operations status',
    prompt: 'Show operations status for my authorized scope.',
  },
  'audit.own': { label: 'My audit trail', prompt: 'Show my scoped audit trail.' },
  'tenant.manage': {
    label: 'Tenant management',
    prompt: 'Show tenant management options available to me.',
  },
  'account.status': { label: 'Account status', prompt: 'Show my account status.' },
  'support.contact': { label: 'Contact support', prompt: 'Help me contact support.' },
  'game.start': { label: 'Start a game', prompt: 'Start an AgentOS game.' },
  'practice.explain': {
    label: 'Explain mode',
    prompt: 'Explain the next action before taking it.',
  },
  'practice.simulate': {
    label: 'Simulation mode',
    prompt: 'Simulate the requested action without changing anything.',
  },
  'assist.snooze': { label: 'Snooze suggestion', prompt: null },
  'assist.dismiss': { label: 'Dismiss suggestion', prompt: null },
  'network.user.kick': { label: 'Kick network user', prompt: null },
  'network.user.disable': { label: 'Disable network user', prompt: null },
  'pos.new_sale': { label: 'New sale', prompt: 'Open a new sale for my authorized site.' },
  'pos.held_sales': { label: 'Held sales', prompt: 'Show held sales for my current shift.' },
  'pos.payment_status': {
    label: 'Payment status',
    prompt: 'Show payment status for my current sale.',
  },
  'pos.receipt': { label: 'Receipt', prompt: 'Prepare the receipt for my current sale.' },
  'pos.shift': {
    label: 'Shift controls',
    prompt: 'Show my current cashier shift and safe shift actions.',
  },
  'team.work_queue': {
    label: 'My work queue',
    prompt: 'Show assigned contractor work in my authorized scope.',
  },
  'team.submit_evidence': {
    label: 'Submit evidence',
    prompt: 'Submit evidence for my assigned work package.',
  },
  'team.next_action': {
    label: 'Next team action',
    prompt: 'Suggest the next authorized action for my assigned work.',
  },
  'team.progress': {
    label: 'Team progress',
    prompt: 'Show team progress, blockers, and earned value for my authorized scope.'
  },
  'team.activity_chart': {
    label: 'Activity chart',
    prompt: 'Show specialist activity numbers, hours, status, and chart data for my authorized scope.'
  },
  'team.specialist_detail': {
    label: 'Specialist activity detail',
    prompt: 'Show activity detail for the selected specialist work package.'
  },
  'team.commission_summary': {
    label: 'Commission summary',
    prompt: 'Show verified and pending commission for my authorized scope.',
  },
  'team.evidence.detail': {
    label: 'Evidence detail',
    prompt: 'Show detailed evidence and QA status for my authorized scope.',
  },
  'team.commission.approve': {
    label: 'Approve commission',
    prompt: 'Review commission approvals requiring my authority.',
  },
  'team.assignment.manage': {
    label: 'Manage assignments',
    prompt: 'Manage contractor assignments within my authorized scope.',
  },
});

export function getActionDefinition(action) {
  return ACTIONS[action] || { label: action, prompt: null };
}

export function buildActionManifest(context = {}) {
  const policy = context.uiPolicy || buildChannelUiPolicy(context);
  return policy.actions
    .filter(action => canRenderAction(policy, action))
    .map(action => ({ action, ...getActionDefinition(action) }));
}

export function buildProposalManifest(proposal = {}, context = {}) {
  const policy = context.uiPolicy || buildChannelUiPolicy(context);
  if (!proposal?.valid || !proposal?.candidates?.length || policy.restricted) return [];
  const top = proposal.candidates[0];
  const actions = ['assist.continue', 'assist.clarify'];
  if (top.requiresApproval) actions.push('assist.approve');
  actions.push('assist.snooze', 'assist.dismiss');
  return actions
    .filter(
      action =>
        ['assist.continue', 'assist.clarify', 'assist.snooze', 'assist.dismiss'].includes(action) ||
        canRenderAction(policy, action)
    )
    .map(action => ({ action, ...getActionDefinition(action), proposalId: proposal.proposalId }));
}

export function actionPrompt(action, query = '') {
  if (action === 'research.deep_search') {
    return query.trim() ? `deep search: ${query.trim()}` : 'deep search';
  }
  return getActionDefinition(action).prompt || action;
}

export function actionCallback(action) {
  return `ui:${encodeURIComponent(action)}`;
}

export function parseActionCallback(value) {
  if (typeof value !== 'string' || !value.startsWith('ui:')) return null;
  try {
    return decodeURIComponent(value.slice(3));
  } catch {
    return null;
  }
}

export default {
  buildActionManifest,
  buildProposalManifest,
  getActionDefinition,
  actionPrompt,
  actionCallback,
  parseActionCallback,
};
