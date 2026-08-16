import { BaseProvider } from './BaseProvider.js';

class NanoAIProvider extends BaseProvider {
  static getMetadata() {
    return {
      name: 'Nano.ai',
      envKey: 'NANO_AI_API_KEY',
      defaultModel: 'nano',
      tier: 3,
      supportsTools: true,
      supportsVision: true
    };
  }

  constructor(config = {}) {
    super(config);
    this.model = config.model || process.env.NANO_AI_MODEL || 'nano';
    this.apiKey = config.apiKey || process.env.NANO_AI_API_KEY;
    this.base = (config.baseURL || process.env.NANO_AI_BASE_URL || '').replace(/\/$/, '');
    this.timeoutMs = Number(config.timeoutMs || process.env.NANO_AI_TIMEOUT_MS || 120000);
  }

  async initialize() {
    if (!this.apiKey) throw new Error('NANO_AI_API_KEY not configured');
    if (!this.base) throw new Error('NANO_AI_BASE_URL not configured');
    return this;
  }

  _content(message) {
    if (typeof message?.content === 'string') return message.content;
    if (Array.isArray(message?.content)) return message.content;
    return '';
  }

  async generate(messages, tools = []) {
    await this.initialize();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: messages.map((message) => ({ role: message.role, content: this._content(message) })),
          ...(tools.length ? {
            tools: tools.map((tool) => ({ type: 'function', function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters || { type: 'object', properties: {} }
            } })),
            tool_choice: 'auto'
          } : {})
        }),
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || `Nano.ai API error (${response.status})`);
      const message = data.choices?.[0]?.message || {};
      const calls = (message.tool_calls || []).map((call) => ({
        name: call.function?.name,
        args: JSON.parse(call.function?.arguments || '{}'),
        id: call.id
      }));
      return {
        text: message.content || '',
        calls: calls.length ? calls : null,
        usage: {
          inputTokens: data.usage?.prompt_tokens,
          outputTokens: data.usage?.completion_tokens
        },
        provider: 'nano.ai',
        model: data.model || this.model
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async listModels() {
    await this.initialize();
    const response = await fetch(`${this.base}/models`, { headers: { Authorization: `Bearer ${this.apiKey}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || `Nano.ai models request failed (${response.status})`);
    return data.data || [];
  }

  async validateKey() {
    try {
      const models = await this.listModels();
      return { valid: true, models: models.map((model) => model.id) };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }
}

BaseProvider.register('nano.ai', NanoAIProvider);
BaseProvider.register('nanoai', NanoAIProvider);
BaseProvider.register('nano', NanoAIProvider);
export { NanoAIProvider };
export default NanoAIProvider;

