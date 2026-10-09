/**
 * Canonical model policy for AgentOS.
 *
 * Providers are adapters; orchestration selects a capability tier, not a
 * provider-specific model string. Deployments can override IDs through env.
 * The defaults track the current provider catalogs rather than ChatGPT UI
 * model names. See provider adapters for endpoint-specific capabilities.
 */

const DEFAULTS = Object.freeze({
  reasoning: process.env.AGENTOS_MODEL_REASONING || 'gpt-6-astra',
  balanced: process.env.AGENTOS_MODEL_BALANCED || 'gpt-5.6-terra',
  fast: process.env.AGENTOS_MODEL_FAST || 'gpt-5.6-luna',
  multimodal: process.env.AGENTOS_MODEL_MULTIMODAL || 'gpt-6-astra',
  live: process.env.AGENTOS_MODEL_LIVE || 'gpt-realtime-2.1',
  embedding: process.env.AGENTOS_MODEL_EMBEDDING || 'text-embedding-3-large',
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
