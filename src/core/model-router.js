/**
 * Canonical model policy for AgentOS.
 *
 * Providers are adapters; orchestration selects a capability tier, not a
 * provider-specific model string. This keeps every channel/domain on the same
 * model policy while allowing deployments to override model IDs through env.
 */

const DEFAULTS = Object.freeze({
  reasoning: process.env.AGENTOS_MODEL_REASONING || 'gpt-5.6-sol',
  balanced: process.env.AGENTOS_MODEL_BALANCED || 'gpt-5.6-terra',
  fast: process.env.AGENTOS_MODEL_FAST || 'gpt-5.6-luna',
  multimodal: process.env.AGENTOS_MODEL_MULTIMODAL || 'gemini-3.8-flash',
  live: process.env.AGENTOS_MODEL_LIVE || 'gemini-3.1-flash-live-preview',
  embedding: process.env.AGENTOS_MODEL_EMBEDDING || 'gemini-embedding-2-preview',
});

const TASK_TIERS = Object.freeze({
  planning: 'reasoning',
  coding: 'reasoning',
  architecture: 'reasoning',
  security: 'reasoning',
  research: 'reasoning',
  execution: 'balanced',
  tool_use: 'balanced',
  routing: 'fast',
  classification: 'fast',
  summarization: 'fast',
  vision: 'multimodal',
  audio: 'live',
  retrieval: 'embedding',
});

export function resolveModel({ task = 'execution', tier, override } = {}) {
  if (override) return override;
  const selectedTier = tier || TASK_TIERS[task] || 'balanced';
  return DEFAULTS[selectedTier] || DEFAULTS.balanced;
}

export function getModelPolicy() {
  return {
    defaults: { ...DEFAULTS },
    taskTiers: { ...TASK_TIERS },
  };
}

export default { resolveModel, getModelPolicy };
