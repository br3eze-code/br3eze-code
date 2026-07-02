// src/ai/AIRouter.js
const ClaudeAdapter = require('../../adapters/claude.adapter');
const OpenAIAdapter = require('../../adapters/openai.adapter');
const GeminiAdapter = require('../../adapters/gemini.adapter');
class AIRouter {
  constructor() {
    this.providers = {
      anthropic: new ClaudeAdapter(),
      openai: new OpenAIAdapter(),
      // TODO: xAI/Grok adapter not yet implemented
      gemini: new GeminiAdapter(), // Keep br3ezeclaw's default
    };
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
