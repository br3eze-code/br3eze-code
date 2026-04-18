// src/ai/AIRouter.js
const AnthropicAdapter = require('../../adapters/claude.adapter');
const OpenAIAdapter = require('../../adapters/openai.adapter');
const GeminiAdapter = require('../../adapters/gemini.adapter');
const XAIAdapter = require('../../adapters/xai.adapter');

class AIRouter {
  constructor() {
    this.providers = {
    anthropic: new AnthropicAdapter(process.env.ANTHROPIC_API_KEY),
      openai: new OpenAIAdapter(process.env.OPENAI_API_KEY),
      gemini: new GeminiAdapter(process.env.GEMINI_API_KEY),
      xai: new XAIAdapter(process.env.XAI_API_KEY),
    };
    this.defaultProvider = this.providers[defaultProvider];
  }

  // Prefix-based routing like claw-code
  // "anthropic: analyze logs" vs "gemini: reboot router"
  async route(prompt, context) {
    const [prefix, ...rest] = prompt.split(':');
    const provider = this.providers[prefix.trim()] || this.defaultProvider;
    return provider.complete(rest.join(':'), context);
  }

  // Domain-specific prompt engineering
  buildSystemPrompt(domain, intent) {
    const base = `You are AgentOS v2, a domain-agnostic agent orchestrator.`;
    const domainContext = this.kernel.domains.get(domain).getContext();
    return `${base}\nCurrent domain: ${domain}\n${domainContext}`;
  }
}
