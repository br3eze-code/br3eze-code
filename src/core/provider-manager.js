import { Logger } from '../utils/logger.js';

/** Provider-neutral failover manager. Concrete model providers are injected. */
class ProviderManager {
  constructor(options = {}) {
    this.providers = new Map();
    this.primary = options.primary || process.env.PRIMARY_PROVIDER || null;
    this.fallbacks = options.fallbacks || (process.env.FALLBACK_PROVIDERS ? process.env.FALLBACK_PROVIDERS.split(',').map((name) => name.trim()).filter(Boolean) : []);
    this.logger = options.logger || new Logger('ProviderManager');
    this.ready = this.registerInjected(options.providers || options.providerFactories || {});
  }

  async registerInjected(entries) {
    for (const [name, value] of Object.entries(entries || {})) {
      try { const provider = typeof value === 'function' ? await value() : value; if (provider) this.providers.set(name, provider); }
      catch (error) { this.logger.warn(`Failed to load provider ${name}: ${error.message}`); }
    }
    if (!this.primary) this.primary = this.providers.keys().next().value || null;
    return this;
  }
  register(name, provider) { if (!name || !provider) throw new TypeError('provider name and instance are required'); this.providers.set(String(name), provider); if (!this.primary) this.primary = String(name); return provider; }
  async execute(conversation, tools, options = {}) { await this.ready; const names = [...new Set([options.provider, this.primary, ...this.fallbacks].filter(Boolean))]; for (const name of names) { const provider = this.providers.get(name); if (!provider?.execute) continue; try { return this.normalizeResponse(await provider.execute(conversation, tools, options)); } catch (error) { this.logger.warn(`Provider ${name} failed: ${error.message}`); } } throw new Error('All configured providers failed'); }
  async executeWithProvider(providerName, conversation, tools, options = {}) { await this.ready; const provider = this.providers.get(providerName); if (!provider?.execute) throw new Error(`Provider not found: ${providerName}`); return this.normalizeResponse(await provider.execute(conversation, tools, options)); }
  normalizeResponse(raw) { if (!raw || typeof raw !== 'object') return raw; if (raw.candidates) return { content: raw.candidates[0]?.content?.parts?.[0]?.text || '', toolCalls: this.extractToolCalls(raw), provider: raw.provider || null }; if (raw.content) return { content: Array.isArray(raw.content) ? (raw.content[0]?.text || '') : raw.content, toolCalls: this.extractToolCalls(raw), provider: raw.provider || null }; if (raw.choices) { const message=raw.choices[0]?.message; return { content: message?.content || '', toolCalls: (message?.tool_calls || []).map(t => ({ id:t.id, name:t.function?.name, arguments:this.parseArguments(t.function?.arguments) })), provider: raw.provider || null }; } return raw; }
  parseArguments(value) { if (!value) return {}; if (typeof value === 'object') return value; try { return JSON.parse(value); } catch { return {}; } }
  extractToolCalls(raw) { return raw.toolCalls || raw.candidates?.[0]?.content?.parts?.filter(p => p.functionCall).map((p,i) => ({ id:`tool-${i}`, name:p.functionCall.name, arguments:p.functionCall.args || {} })) || []; }
  getAvailableProviders() { return [...this.providers.keys()]; }
  getProviderInfo(name) { const provider=this.providers.get(name); return provider?.getInfo ? provider.getInfo() : null; }
}
export { ProviderManager };
export default ProviderManager;
