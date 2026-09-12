import { Logger } from '../utils/logger.js';

/**
 * Provider Manager
 *
 * Native ESM provider loading with a single failover contract.
 * Optional providers are loaded only when configured, so one unavailable
 * integration cannot prevent AgentOS from starting.
 */
class ProviderManager {
  constructor(options = {}) {
    this.providers = new Map();
    this.primary = options.primary || process.env.PRIMARY_PROVIDER || 'gemini';
    this.fallbacks = options.fallbacks || (process.env.FALLBACK_PROVIDERS
      ? process.env.FALLBACK_PROVIDERS.split(',').map((name) => name.trim()).filter(Boolean)
      : []);
    this.logger = options.logger || new Logger('ProviderManager');
    this.ready = this.initializeProviders();
  }

  async initializeProviders() {
    const providerConfigs = [
      { name: 'gemini', envKey: 'GEMINI_API_KEY', module: '../providers/gemini.js' },
      { name: 'claude', envKey: 'ANTHROPIC_API_KEY', module: '../providers/claude.js' },
      { name: 'openai', envKey: 'OPENAI_API_KEY', module: '../providers/openai.js' },
      { name: 'ollama', envKey: null, module: '../providers/ollama.js' },
    ];

    await Promise.all(providerConfigs.map(async (config) => {
      if (config.envKey && !process.env[config.envKey]) return;
      try {
        const imported = await import(config.module);
        const ProviderClass = imported.default || imported[`${config.name[0].toUpperCase()}${config.name.slice(1)}Provider`];
        if (typeof ProviderClass !== 'function') throw new TypeError('provider module has no constructible default export');
        this.providers.set(config.name, new ProviderClass());
        this.logger.info(`Registered provider: ${config.name}`);
      } catch (error) {
        this.logger.warn(`Failed to load provider ${config.name}: ${error.message}`);
      }
    }));

    return this;
  }

  async execute(conversation, tools) {
    await this.ready;
    const providersToTry = [...new Set([this.primary, ...this.fallbacks])];
    for (const providerName of providersToTry) {
      const provider = this.providers.get(providerName);
      if (!provider) continue;
      try {
        this.logger.debug(`Trying provider: ${providerName}`);
        return this.normalizeResponse(await provider.execute(conversation, tools));
      } catch (error) {
        this.logger.warn(`Provider ${providerName} failed: ${error.message}`);
      }
    }
    throw new Error('All configured providers failed');
  }

  async executeWithProvider(providerName, conversation, tools) {
    await this.ready;
    const provider = this.providers.get(providerName);
    if (!provider) throw new Error(`Provider not found: ${providerName}`);
    return this.normalizeResponse(await provider.execute(conversation, tools));
  }

  normalizeResponse(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    if (raw.candidates) {
      return {
        content: raw.candidates[0]?.content?.parts?.[0]?.text || '',
        toolCalls: this.extractGeminiToolCalls(raw),
        provider: 'gemini',
      };
    }
    if (raw.content) {
      return {
        content: Array.isArray(raw.content) ? (raw.content[0]?.text || '') : raw.content,
        toolCalls: this.extractClaudeToolCalls(raw),
        provider: 'claude',
      };
    }
    if (raw.choices) {
      const message = raw.choices[0]?.message;
      return {
        content: message?.content || '',
        toolCalls: (message?.tool_calls || []).map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.function?.name,
          arguments: this.parseArguments(toolCall.function?.arguments),
        })),
        provider: 'openai',
      };
    }
    return raw;
  }

  parseArguments(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return {}; }
  }

  extractGeminiToolCalls(raw) {
    const parts = raw.candidates?.[0]?.content?.parts || [];
    return parts.filter((part) => part.functionCall).map((part) => ({
      id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: part.functionCall.name,
      arguments: part.functionCall.args || {},
    }));
  }

  extractClaudeToolCalls(raw) {
    return (Array.isArray(raw.content) ? raw.content : [])
      .filter((content) => content.type === 'tool_use')
      .map((toolUse) => ({ id: toolUse.id, name: toolUse.name, arguments: toolUse.input || {} }));
  }

  async getAvailableProviders() {
    await this.ready;
    return [...this.providers.keys()];
  }

  async getProviderInfo(name) {
    await this.ready;
    const provider = this.providers.get(name);
    return provider?.getInfo ? provider.getInfo() : null;
  }
}

export { ProviderManager };
export default ProviderManager;
