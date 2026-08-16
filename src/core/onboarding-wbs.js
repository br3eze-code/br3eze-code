import { buildExecutionContext } from './execution-context.js';
import {
  createActionWbs,
  summarizeActionWbs,
  formatWbsForPrompt,
} from './action-wbs.js';
import { instantiateWorkPackages } from './wbs-work-packages.js';

/**
 * Build the smallest useful onboarding plan for a first user interaction.
 * The plan is context-only: it does not execute mutations or infer identity.
 */
export function createOnboardingWbs(context = {}, input = {}) {
  const scope = buildExecutionContext({ ...context, input });
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
  const context = buildExecutionContext({
    ...frame,
    message: frame.message || frame.msg || frame,
  });
  const existing = Array.isArray(frame.wbs) && frame.wbs.length > 0
    ? {
      wbs: frame.wbs,
      wbsSummary: frame.wbsSummary || summarizeActionWbs(frame.wbs),
      wbsPrompt: frame.wbsPrompt || formatWbsForPrompt(frame.wbs, frame.wbsSummary),
      nextAction: frame.nextAction || null,
    }
    : createOnboardingWbs(context, { text: frame.content || frame.text || frame.action });

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

export default { createOnboardingWbs, attachOnboardingWbs };
