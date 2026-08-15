import { BaseProvider } from './BaseProvider.js';

/**
 * xAI provider for Grok. The API is OpenAI-compatible; AgentOS keeps the
 * provider behind the common BaseProvider contract so channels remain model-neutral.
 */
class XAIProvider extends BaseProvider {
    static getMetadata() {
        return {
            name: 'xAI (Grok)',
            envKey: 'XAI_API_KEY',
            defaultModel: 'grok-4.6',
            tier: 1,
            supportsTools: true,
            supportsVision: true
        };
    }

    constructor(config = {}) {
        super(config);
        this.model = config.model || process.env.XAI_MODEL || 'grok-4.6';
        this.apiKey = config.apiKey || process.env.XAI_API_KEY;
        this.base = (config.baseURL || process.env.XAI_BASE_URL || 'https://api.x.ai/v1').replace(/\/$/, '');
        this.timeoutMs = Number(config.timeoutMs || process.env.XAI_TIMEOUT_MS || 120000);
    }

    async initialize() {
        if (!this.apiKey) throw new Error('XAI_API_KEY not configured');
        return this;
    }

    _content(message) {
        if (typeof message.content === 'string') return message.content;
        if (Array.isArray(message.content)) return message.content;
        if (Array.isArray(message.blocks)) {
            return message.blocks.map((block) => block.type === 'text' ? block.text : block).filter(Boolean);
        }
        return '';
    }

    async generate(messages, tools = []) {
        await this.initialize();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await fetch(`${this.base}/chat/completions`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: messages.map((message) => ({ role: message.role, content: this._content(message) })),
                    ...(tools.length ? { tools: tools.map((tool) => ({
                        type: 'function',
                        function: {
                            name: tool.name,
                            description: tool.description,
                            parameters: tool.parameters || { type: 'object', properties: {} }
                        }
                    })), tool_choice: 'auto' } : {})
                }),
                signal: controller.signal
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error?.message || `xAI API error (${response.status})`);
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
                    promptTokenCount: data.usage?.prompt_tokens,
                    candidatesTokenCount: data.usage?.completion_tokens
                },
                provider: 'xai',
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
        if (!response.ok) throw new Error(data.error?.message || `xAI models request failed (${response.status})`);
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

    async embed() {
        throw new Error('xAI does not provide embeddings; use the configured open-model embedding provider.');
    }
}

BaseProvider.register('xai', XAIProvider);
BaseProvider.register('grok', XAIProvider);
export { XAIProvider };
