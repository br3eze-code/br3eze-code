import { summarizeActionWbs } from './action-wbs.js';

const MAX_CANDIDATES = 3;
const PROPOSAL_TTL_MS = 15 * 60 * 1000;

const ACTIONS = Object.freeze({
  'assist.clarify': { risk: 'low', requiresApproval: false, label: 'Clarify the next step' },
  'assist.continue': { risk: 'low', requiresApproval: false, label: 'Continue the current task' },
  'assist.prepare': { risk: 'low', requiresApproval: false, label: 'Prepare a read-only preview' },
  'assist.approve': { risk: 'high', requiresApproval: true, label: 'Approve the proposed action' },
  'assist.resolve_blocker': { risk: 'low', requiresApproval: false, label: 'Resolve the current blocker' },
  'assist.verify': { risk: 'low', requiresApproval: false, label: 'Verify the result' },
  'account.status': { risk: 'low', requiresApproval: false, label: 'View account status' },
});

const MUTATING_ACTIONS = new Set([
  'network.user.kick',
  'network.user.disable',
  'system.reboot',
  'payment.transfer',
  'payment.capture',
  'account.suspend',
]);

const normalize = (value) => String(value || '').trim();
const isActive = (context = {}) => !['disabled', 'suspended', 'banned', 'pending'].includes(normalize(context.status || context.userDoc?.status).toLowerCase());
const hasCapability = (context = {}, capability) => {
  const values = context.authorizedCapabilities || context.capabilities || [];
  return Array.isArray(values) && (values.includes('*') || values.includes(capability));
};

function currentStep(task) {
  return (task?.wbs || []).find((step) => ['running', 'pending'].includes(step.status)) || null;
}

function scopeMissing(context = {}) {
  return ['tenantId', 'domainId', 'siteId'].filter((key) => !normalize(context[key] || context.userDoc?.[key]));
}

function candidate(actionId, task, context, overrides = {}) {
  const definition = ACTIONS[actionId] || { risk: 'low', requiresApproval: false, label: actionId };
  const step = currentStep(task);
  return {
    actionId,
    label: definition.label,
    wbsStepId: step?.id || null,
    reasonCodes: [],
    evidence: [],
    confidence: 0,
    urgency: 'normal',
    risk: definition.risk,
    requiresApproval: definition.requiresApproval || MUTATING_ACTIONS.has(actionId),
    requiredCapabilities: [],
    estimatedEffortSeconds: 60,
    ...overrides,
  };
}

export function getLegalNextActionIds(context = {}) {
  if (!isActive(context)) return ['account.status'];
  return Object.keys(ACTIONS).filter((actionId) => actionId !== 'assist.approve');
}

export function generateNextActionCandidates({ task = null, context = {}, now = Date.now() } = {}) {
  const ctx = context || {};
  const candidates = [];
  if (!isActive(ctx)) {
    return [candidate('account.status', task, ctx, {
      confidence: 0.99,
      reasonCodes: ['account_not_active'],
      evidence: ['context:status'],
    })];
  }

  const missing = scopeMissing(ctx);
  if (missing.length) {
    candidates.push(candidate('assist.clarify', task, ctx, {
      confidence: 0.98,
      reasonCodes: ['missing_scope'],
      evidence: missing.map((field) => `context:${field}=null`),
      urgency: 'high',
      estimatedEffortSeconds: 30,
    }));
  }

  const step = currentStep(task);
  if (task && ['failed', 'stopped'].includes(task.status)) {
    candidates.push(candidate('assist.resolve_blocker', task, ctx, {
      confidence: 0.96,
      reasonCodes: ['task_blocked'],
      evidence: [`task:status=${task.status}`],
      urgency: 'high',
    }));
  } else if (step?.key === 'confirm' || step?.key === 'approve') {
    candidates.push(candidate('assist.approve', task, ctx, {
      confidence: 0.97,
      reasonCodes: ['approval_pending'],
      evidence: [`wbs:${step.id}:pending`],
      urgency: 'high',
      risk: 'high',
      requiresApproval: true,
    }));
  } else if (step?.key === 'verify' || step?.key === 'audit') {
    candidates.push(candidate('assist.verify', task, ctx, {
      confidence: 0.94,
      reasonCodes: ['verification_pending'],
      evidence: [`wbs:${step.id}:pending`],
    }));
  } else if (step) {
    candidates.push(candidate('assist.continue', task, ctx, {
      confidence: 0.91,
      reasonCodes: ['wbs_step_ready'],
      evidence: [`wbs:${step.id}:${step.status}`],
      requiredCapabilities: step.key === 'execute' ? (ctx.requiredCapabilities || []) : [],
    }));
  }

  if (!candidates.length || (candidates.length < MAX_CANDIDATES && task?.wbsSummary?.progress > 0)) {
    candidates.push(candidate('assist.prepare', task, ctx, {
      confidence: 0.72,
      reasonCodes: ['read_only_preparation_available'],
      evidence: ['context:canonical'],
      estimatedEffortSeconds: 45,
    }));
  }

  const legal = new Set(getLegalNextActionIds(ctx));
  return candidates
    .filter((item) => legal.has(item.actionId))
    .map((item) => ({ ...item, expiresAt: new Date(now + PROPOSAL_TTL_MS).toISOString() }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_CANDIDATES);
}

export function validateNextActionProposal(proposal, { task = null, context = {}, now = Date.now() } = {}) {
  const errors = [];
  if (!proposal || typeof proposal !== 'object') errors.push('proposal_required');
  const candidateItem = proposal?.candidates?.[0];
  if (!candidateItem) errors.push('candidate_required');
  if (candidateItem && !getLegalNextActionIds(context).includes(candidateItem.actionId)) errors.push('action_not_legal');
  if (candidateItem && (candidateItem.confidence < 0 || candidateItem.confidence > 1)) errors.push('confidence_out_of_range');
  if (candidateItem?.requiresApproval && !['assist.approve'].includes(candidateItem.actionId) && !MUTATING_ACTIONS.has(candidateItem.actionId)) errors.push('approval_contract_invalid');
  if (candidateItem?.wbsStepId && !(task?.wbs || []).some((step) => step.id === candidateItem.wbsStepId)) errors.push('wbs_step_not_found');
  if (proposal?.expiresAt && Date.parse(proposal.expiresAt) <= now) errors.push('proposal_expired');
  return { valid: errors.length === 0, errors };
}

export function createNextActionProposal({ task = null, context = {}, now = Date.now() } = {}) {
  const candidates = generateNextActionCandidates({ task, context, now });
  const proposal = {
    proposalId: `nap_${normalize(task?.taskId) || 'session'}_${now}`,
    taskId: task?.taskId || null,
    candidates,
    speakNow: candidates[0]?.confidence >= 0.85 && candidates[0]?.risk !== 'high',
    notificationReason: candidates[0]?.reasonCodes?.[0] || 'workflow_progress',
    wbsSummary: summarizeActionWbs(task?.wbs || []),
    createdAt: new Date(now).toISOString(),
    expiresAt: candidates[0]?.expiresAt || new Date(now + PROPOSAL_TTL_MS).toISOString(),
  };
  const validation = validateNextActionProposal(proposal, { task, context, now });
  return { ...proposal, valid: validation.valid, validationErrors: validation.errors };
}

export { ACTIONS, MUTATING_ACTIONS, PROPOSAL_TTL_MS };
export default { generateNextActionCandidates, validateNextActionProposal, createNextActionProposal, getLegalNextActionIds };
