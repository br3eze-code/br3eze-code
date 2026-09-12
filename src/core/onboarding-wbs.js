import { buildExecutionContext } from './execution-context.js';
import {
  createActionWbs,
  summarizeActionWbs,
  formatWbsForPrompt,
} from './action-wbs.js';
import { instantiateWorkPackages } from './wbs-work-packages.js';
import { resolveModel } from './model-router.js';

const ONBOARDING_STEPS = Object.freeze([
  'receive',
  'identify',
  'understand',
  'scope',
  'plan',
  'authorize',
  'execute',
  'observe',
  'evaluate',
  'verify',
  'complete',
]);

function normalizeChannel(input = {}) {
  return String(
    input.channel || input.source || input.platform || input.transport || 'unknown',
  ).trim().toLowerCase() || 'unknown';
}

/**
 * Universal onboarding envelope. Every channel enters the same WBS and model
 * policy; channel adapters are responsible only for transport concerns.
 */
export function createOnboardingWbs(context = {}, input = {}) {
  const channel = normalizeChannel(input);
  const task = input.task || input.intent || 'execution';
  const model = resolveModel({ task, tier: input.modelTier, override: input.model });
  const scope = buildExecutionContext({ ...context, input, channel, model, onboardingSteps: ONBOARDING_STEPS });
  const wbs = createActionWbs('assist.task', {
    context: scope,
    input: { text: input.text || input.action || 'Start AgentOS onboarding' },
  });
  const summary = summarizeActionWbs(wbs);
  const next = wbs.find((step) => step.status === 'running' || step.status === 'pending') || null;

  return {
    wbs,
    workPackages: scope.agentRole ? instantiateWorkPackages(scope.agentRole, scope) : [],
    wbsSummary: summary,
    channel,
    model,
    task,
    onboardingSteps: [...ONBOARDING_STEPS],
    nextAction: next ? {
      id: next.id,
      key: next.key,
      title: next.title,
      requiresApproval: next.key === 'execute',
    } : null,
    wbsPrompt: formatWbsForPrompt(wbs, summary),
  };
}

export function attachOnboardingWbs(frame = {}) {
  const message = frame.message || frame.msg || frame;
  const context = buildExecutionContext({
    ...frame,
    message,
    channel: normalizeChannel(frame),
  });
  const existing = Array.isArray(frame.wbs) && frame.wbs.length > 0
    ? {
      wbs: frame.wbs,
      wbsSummary: frame.wbsSummary || summarizeActionWbs(frame.wbs),
      wbsPrompt: frame.wbsPrompt || formatWbsForPrompt(frame.wbs, frame.wbsSummary),
      nextAction: frame.nextAction || null,
      channel: normalizeChannel(frame),
      model: frame.model || resolveModel({ task: frame.task || 'execution', tier: frame.modelTier, override: frame.model }),
      task: frame.task || 'execution',
      onboardingSteps: [...ONBOARDING_STEPS],
    }
    : createOnboardingWbs(context, {
      text: frame.content || frame.text || frame.action,
      channel: normalizeChannel(frame),
      task: frame.task || frame.intent || 'execution',
      model: frame.model,
      modelTier: frame.modelTier,
    });

  return {
    ...frame,
    ...context,
    workPackages: Array.isArray(frame.workPackages) && frame.workPackages.length
      ? frame.workPackages
      : (context.agentRole ? instantiateWorkPackages(context.agentRole, context) : []),
    ...existing,
    context: { ...context, ...existing },
  };
}

export { ONBOARDING_STEPS };
export default { createOnboardingWbs, attachOnboardingWbs, ONBOARDING_STEPS };
