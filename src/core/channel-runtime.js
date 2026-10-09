import { attachOnboardingWbs } from './onboarding-wbs.js';

/**
 * Universal channel-to-agent boundary.
 * Transport adapters should normalize delivery metadata and hand the request
 * here; business/domain logic must not branch on Telegram, WhatsApp, web, CLI,
 * SMS, or another transport.
 */
export async function processChannelMessage({ agent, message, context = {} } = {}) {
  if (!agent || typeof agent.processInteraction !== 'function') {
    throw new TypeError('agent.processInteraction() is required');
  }

  const frame = attachOnboardingWbs({
    ...context,
    message,
    channel: context.channel || context.source || context.platform || 'unknown',
  });

  const result = await agent.processInteraction(message, {
    ...context,
    channel: frame.channel,
    model: frame.model,
    task: frame.task,
    wbs: frame.wbs,
    wbsSummary: frame.wbsSummary,
    onboardingSteps: frame.onboardingSteps,
    workPackages: frame.workPackages,
  });

  return {
    result,
    frame,
  };
}

export default processChannelMessage;
