import { buildChannelUiPolicy, canRenderAction } from './channel-ui-policy.js';

const ACTIONS = Object.freeze({
  'help': { label: 'Help', prompt: 'Show me what you can do.' },
  'context.show': { label: 'Show context', prompt: 'Show my current scoped context.' },
  'context.clear': { label: 'Clear context', prompt: 'Clear only my current conversation context.' },
  'research.deep_search': { label: 'Deep search', prompt: null },
  'assist.task': { label: 'Assist with a task', prompt: null },
  'network.suggest': { label: 'Network suggestions', prompt: 'Suggest safe network actions for my current authorized scope.' },
  'device.nearby.discover': { label: 'Nearby devices', prompt: 'Discover nearby devices within my authorized scope.' },
  'operations.status': { label: 'Operations status', prompt: 'Show operations status for my authorized scope.' },
  'audit.own': { label: 'My audit trail', prompt: 'Show my scoped audit trail.' },
  'tenant.manage': { label: 'Tenant management', prompt: 'Show tenant management options available to me.' },
  'account.status': { label: 'Account status', prompt: 'Show my account status.' },
  'support.contact': { label: 'Contact support', prompt: 'Help me contact support.' },
  'game.start': { label: 'Start a game', prompt: 'Start an AgentOS game.' },
  'practice.explain': { label: 'Explain mode', prompt: 'Explain the next action before taking it.' },
  'practice.simulate': { label: 'Simulation mode', prompt: 'Simulate the requested action without changing anything.' },
  'network.user.kick': { label: 'Kick network user', prompt: null },
  'network.user.disable': { label: 'Disable network user', prompt: null },
});

export function getActionDefinition(action) {
  return ACTIONS[action] || { label: action, prompt: null };
}

export function buildActionManifest(context = {}) {
  const policy = context.uiPolicy || buildChannelUiPolicy(context);
  return policy.actions
    .filter((action) => canRenderAction(policy, action))
    .map((action) => ({ action, ...getActionDefinition(action) }));
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

export default { buildActionManifest, getActionDefinition, actionPrompt, actionCallback, parseActionCallback };
