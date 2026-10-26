/**
 * Compose a configured provider at the host boundary.
 *
 * Provider selection belongs to the composition layer, not AgentRuntime/Core.
 * The first configured provider in primary + fallback order is selected.
 */
import { createProviderModelPort } from './provider-model-port.js';

const PROVIDERS = Object.freeze({
  openai: {
    envKey: 'OPENAI_API_KEY',
    load: () => import('../../core/llm/providers/OpenAIProvider.js').then((module) => module.OpenAIProvider),
  },
  gpt: {
    envKey: 'OPENAI_API_KEY',
    load: () => import('../../core/llm/providers/OpenAIProvider.js').then((module) => module.OpenAIProvider),
  },
  gemini: {
    envKey: 'GEMINI_API_KEY',
    load: () => import('../../core/llm/providers/GeminiProvider.js').then((module) => module.GeminiProvider),
  },
  anthropic: {
    envKey: 'ANTHROPIC_API_KEY',
    load: () => import('../../core/llm/providers/AnthropicProvider.js').then((module) => module.AnthropicProvider),
  },
  claude: {
    envKey: 'ANTHROPIC_API_KEY',
    load: () => import('../../core/llm/providers/AnthropicProvider.js').then((module) => module.AnthropicProvider),
  },
  openrouter: {
    envKey: 'OPENROUTER_API_KEY',
    load: () => import('../../core/llm/providers/OpenRouterProvider.js').then((module) => module.OpenRouterProvider),
  },
  groq: {
    envKey: 'GROQ_API_KEY',
    load: () => import('../../core/llm/providers/GroqProvider.js').then((module) => module.GroqProvider),
  },
  deepseek: {
    envKey: 'DEEPSEEK_API_KEY',
    load: () => import('../../core/llm/providers/DeepSeekProvider.js').then((module) => module.DeepSeekProvider),
  },
  ollama: {
    envKey: null,
    load: () => import('../../core/llm/providers/OllamaProvider.js').then((module) => module.OllamaProvider),
    isConfigured: (env, explicit) => explicit || Boolean(env.OLLAMA_BASE_URL),
  },
  local: {
    envKey: null,
    load: () => import('../../core/llm/providers/OllamaProvider.js').then((module) => module.OllamaProvider),
    isConfigured: (env, explicit) => explicit || Boolean(env.OLLAMA_BASE_URL),
  },
});

function unique(values) {
  return [...new Set(values.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))];
}

/**
 * @param {{config?: object, env?: NodeJS.ProcessEnv}} options
 * @returns {Promise<ReturnType<typeof createProviderModelPort>|null>}
 */
export async function createConfiguredProviderModelPort({ config = {}, env = process.env } = {}) {
  const llm = config.llm || {};
  const explicit = env.LLM_PROVIDER || env.AI_PROVIDER || llm.primary || '';
  const candidates = unique([explicit, ...(Array.isArray(llm.fallbacks) ? llm.fallbacks : [])]);

  for (const name of candidates) {
    const definition = PROVIDERS[name];
    if (!definition) continue;

    const isExplicit = name === String(explicit).toLowerCase();
    const apiKey = definition.envKey ? env[definition.envKey] : null;
    const configured = definition.envKey
      ? Boolean(apiKey)
      : Boolean(definition.isConfigured?.(env, isExplicit));
    if (!configured) continue;

    const Provider = await definition.load();
    const openAICompatible = ['openai', 'gpt'].includes(name);
    const model = env.LLM_MODEL || llm.model || (openAICompatible ? llm.openModels?.model : undefined);
    const baseURL = openAICompatible ? llm.openModels?.endpoint || undefined : undefined;
    const provider = new Provider({
      ...(apiKey ? { apiKey } : {}),
      ...(model ? { model } : {}),
      ...(baseURL ? { baseURL } : {}),
      ...(name === 'ollama' || name === 'local' ? { baseURL: env.OLLAMA_BASE_URL || undefined } : {}),
    });
    return createProviderModelPort({ provider });
  }

  return null;
}

export { PROVIDERS as CONFIGURED_PROVIDER_ADAPTERS };
