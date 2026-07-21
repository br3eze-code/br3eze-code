/**
 * Provider Manager

 */

import { Logger } from '../utils/logger.js';
import GeminiProvider from '../providers/gemini.js';
import { ClaudeProvider } from '../providers/claude.js';
import { OpenAIProvider } from '../providers/openai.js';
import { OllamaProvider } from '../providers/ollama.js';

const PROVIDER_CLASSES = {
  gemini: GeminiProvider,
  claude: ClaudeProvider,
  openai: OpenAIProvider,
  ollama: OllamaProvider,
};

class ProviderManager {
  constructor(options = {}) {
    this.providers = new Map();
    this.primary = options.primary || process.env.PRIMARY_PROVIDER || 'gemini';
    this.fallbacks = options.fallbacks || 
      (process.env.FALLBACK_PROVIDERS ? process.env.FALLBACK_PROVIDERS.split(',') : []);
    
    this.logger = new Logger('ProviderManager');
    
    this.initializeProviders();
  }
  
  initializeProviders() {
    // Register available providers
    const providerConfigs = [
      { name: 'gemini', envKey: 'GEMINI_API_KEY' },
      { name: 'claude', envKey: 'ANTHROPIC_API_KEY' },
      { name: 'openai', envKey: 'OPENAI_API_KEY' },
      { name: 'ollama', envKey: null } // Local, no key needed
    ];
    
    for (const config of providerConfigs) {
      const hasKey = !config.envKey || process.env[config.envKey];
      if (hasKey) {
        try {
          const ProviderClass = PROVIDER_CLASSES[config.name];
          this.providers.set(config.name, new ProviderClass());
          this.logger.info(`Registered provider: ${config.name}`);
        } catch (error) {
          this.logger.warn(`Failed to load provider ${config.name}:`, error.message);
        }
      }
    }
  }
  
  /**
   * Execute with automatic failover
   */
  async execute(conversation, tools) {
    const providersToTry = [this.primary, ...this.fallbacks];
    
    for (const providerName of providersToTry) {
      const provider = this.providers.get(providerName);
      if (!provider) continue;
      
      try {
        this.logger.debug(`Trying provider: ${providerName}`);
        const result = await provider.execute(conversation, tools);
        
        // Normalize response
        return this.normalizeResponse(result);
        
      } catch (error) {
        this.logger.warn(`Provider ${providerName} failed:`, error.message);
        continue;
      }
    }
    
    throw new Error('All providers failed');
  }
  
  /**
   * Execute with specific provider
   */
  async executeWithProvider(providerName, conversation, tools) {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider not found: ${providerName}`);
    }
    
    const result = await provider.execute(conversation, tools);
    return this.normalizeResponse(result);
  }
  
  /**
   * Normalize response to canonical format
   */
  normalizeResponse(raw) {
    // Handle different provider response formats
    if (raw.candidates) {
      // Gemini format
      return {
        content: raw.candidates[0]?.content?.parts?.[0]?.text || '',
        toolCalls: this.extractGeminiToolCalls(raw),
        provider: 'gemini'
      };
    }
    
    if (raw.content) {
      // Claude format
      return {
        content: raw.content[0]?.text || raw.content || '',
        toolCalls: this.extractClaudeToolCalls(raw),
        provider: 'claude'
      };
    }
    
    if (raw.choices) {
      // OpenAI format
      const message = raw.choices[0]?.message;
      return {
        content: message?.content || '',
        toolCalls: message?.tool_calls?.map(tc => ({
          id: tc.id,
          name: tc.function?.name,
          arguments: JSON.parse(tc.function?.arguments || '{}')
        })),
        provider: 'openai'
      };
    }
    
    // Already normalized or unknown format
    return raw;
  }
  
  extractGeminiToolCalls(raw) {
    const parts = raw.candidates?.[0]?.content?.parts || [];
    return parts
      .filter(p => p.functionCall)
      .map(p => ({
        id: `${Date.now()}-${Math.random()}`,
        name: p.functionCall.name,
        arguments: p.functionCall.args
      }));
  }
  
  extractClaudeToolCalls(raw) {
    // Claude tool use format
    const toolUses = raw.content?.filter(c => c.type === 'tool_use') || [];
    return toolUses.map(tu => ({
      id: tu.id,
      name: tu.name,
      arguments: tu.input
    }));
  }
  
  /**
   * Get available providers
   */
  getAvailableProviders() {
    return Array.from(this.providers.keys());
  }
  
  /**
   * Get provider info
   */
  getProviderInfo(name) {
    const provider = this.providers.get(name);
    return provider ? provider.getInfo() : null;
  }
}

export default { ProviderManager };

