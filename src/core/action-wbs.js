const STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped'
});

const TEMPLATES = Object.freeze({
  'research.deep_search': [
    ['scope', 'Resolve identity, tenant, domain, site, and channel scope'],
    ['retrieve', 'Retrieve and rank relevant sources'],
    ['synthesize', 'Synthesize findings with source boundaries'],
    ['deliver', 'Return a concise answer with citations and usage metadata']
  ],
  'assist.task': [
    ['understand', 'Clarify the requested outcome and constraints'],
    ['plan', 'Build an actionable plan and identify required tools'],
    ['execute', 'Execute only authorized, approved actions'],
    ['verify', 'Verify results and report remaining work']
  ],
  'assist.next_action': [
    ['observe', 'Read the current authorized task and WBS state'],
    ['propose', 'Propose one safe next action with evidence'],
    ['confirm', 'Ask for clarification or approval when required'],
    ['execute', 'Execute only the approved action'],
    ['verify', 'Verify the result and update task progress']
  ],
  'assist.clarify': [
    ['scope', 'Identify the missing scope or intent field'],
    ['ask', 'Ask one bounded clarification question'],
    ['resume', 'Resume the authorized task after the answer']
  ],
  'network.user.kick': [
    ['scope', 'Resolve the authorized tenant, site, domain, and target user'],
    ['confirm', 'Confirm the destructive network operation'],
    ['execute', 'Disconnect the target user through the authorized provider'],
    ['audit', 'Record the scoped outcome without unrelated user data']
  ],
  'network.user.disable': [
    ['scope', 'Resolve the authorized tenant, site, domain, and target user'],
    ['confirm', 'Confirm the account-impacting operation'],
    ['execute', 'Disable the target account and terminate active sessions'],
    ['audit', 'Record the scoped outcome and lifecycle transition']
  ],
  'device.nearby.discover': [
    ['scope', 'Resolve location and nearby-device permission level'],
    ['discover', 'Query only approved nearby device sources'],
    ['filter', 'Remove devices outside the user’s authorized scope'],
    ['deliver', 'Return the permitted device summary']
  ],
  default: [
    ['scope', 'Resolve the canonical execution context'],
    ['authorize', 'Check role, capability, and approval requirements'],
    ['execute', 'Run the action through the approved skill or provider'],
    ['verify', 'Verify the result and publish a scoped audit event']
  ]
});

const cleanText = (value, fallback) => String(value || fallback).trim().slice(0, 500);

export function createActionWbs(action, { context = {}, input = {} } = {}) {
  const template = TEMPLATES[action] || TEMPLATES.default;
  const now = Date.now();
  return template.map(([key, title], index) => ({
    id: `${action}:${key}`,
    order: index + 1,
    key,
    title,
    status: index === 0 ? STATUS.RUNNING : STATUS.PENDING,
    startedAt: index === 0 ? now : null,
    completedAt: null,
    result: null,
    context: {
      tenantId: context.tenantId || null,
      domainId: context.domainId || null,
      siteId: context.siteId || null,
      userId: context.userId || null,
      input: index === 0 ? cleanText(input.text || input.action, '') : null
    }
  }));
}

export function updateActionWbs(wbs, stepId, patch = {}) {
  if (!Array.isArray(wbs)) return [];
  return wbs.map((step) => step.id !== stepId ? step : {
    ...step,
    ...patch,
    status: patch.status || step.status,
    result: patch.result === undefined ? step.result : cleanText(patch.result, ''),
    completedAt: patch.status && [STATUS.COMPLETED, STATUS.FAILED, STATUS.SKIPPED].includes(patch.status)
      ? (patch.completedAt || Date.now())
      : step.completedAt
  });
}

export function completeActionWbsStep(wbs, stepId, result = null) {
  const index = wbs.findIndex((step) => step.id === stepId);
  if (index < 0) return wbs;
  const completed = updateActionWbs(wbs, stepId, { status: STATUS.COMPLETED, result });
  const next = completed[index + 1];
  return next && next.status === STATUS.PENDING
    ? updateActionWbs(completed, next.id, { status: STATUS.RUNNING, startedAt: Date.now() })
    : completed;
}

export function summarizeActionWbs(wbs = []) {
  const counts = Object.values(STATUS).reduce((acc, status) => ({ ...acc, [status]: 0 }), {});
  for (const step of wbs) counts[step.status] = (counts[step.status] || 0) + 1;
  return { total: wbs.length, ...counts, progress: wbs.length ? Math.round((counts.completed / wbs.length) * 100) : 0 };
}

export function formatWbsForPrompt(wbs = [], summary = null) {
  const safeSummary = summary || summarizeActionWbs(wbs);
  const steps = wbs.map((step) => `${step.order}. [${step.status}] ${step.title}${step.result ? ` — ${step.result}` : ''}`).join('\\n');
  return `WBS progress: ${safeSummary.progress}% (${safeSummary.completed}/${safeSummary.total} complete)\\n${steps || 'No WBS steps defined.'}`;
}

export { STATUS as ACTION_WBS_STATUS };
export default { createActionWbs, updateActionWbs, completeActionWbsStep, summarizeActionWbs, formatWbsForPrompt };

