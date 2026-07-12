/**
 * Llama LLM Provider (Meta Open Models)
 */

import { BaseProvider } from './BaseProvider.js';
import { logger } from '../../logger.js';
import { OllamaProvider } from './OllamaProvider.js';
import { GroqProvider } from './GroqProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';

class LlamaProvider extends BaseProvider {
    static getMetadata() {
        return {
            name: 'Meta Llama (via Groq/Together)',
            envKey: 'GROQ_API_KEY',
            defaultModel: 'llama-3.1-70b-versatile',
            tier: 3
        };
    }

    constructor(config = {}) {
        super(config);
        this.model = config.model || process.env.LLAMA_MODEL || 'llama-3.1-70b-versatile';
        this.apiKey = config.apiKey || process.env.GROQ_API_KEY || process.env.TOGETHER_API_KEY;
        this.isLocal = config.isLocal || (this.model.startsWith('local/'));
    }

    async initialize() {}
    async validateKey() {
        if (this.isLocal) {
            return new OllamaProvider().validateKey();
        }
        return new GroqProvider({ apiKey: this.apiKey }).validateKey();
    }

    async generate(messages, tools = []) {
        if (this.isLocal) {
            const local = new OllamaProvider({ model: this.model.replace('local/', '') });
            return local.generate(messages, tools);
        }

        const baseURL = process.env.GROQ_API_KEY ? 'https://api.groq.com/openai/v1' : 'https://api.together.xyz/v1';
        const remote = new OpenAIProvider({ 
            apiKey: this.apiKey, 
            model: this.model,
            baseURL 
        });
        return remote.generate(messages, tools);
    }

    async embed(input) {
        if (this.isLocal) {
            const local = new OllamaProvider({ model: this.model.replace('local/', '') });
            return local.embed(input);
        }
        const baseURL = 'https://api.together.xyz/v1';
        const remote = new OpenAIProvider({ apiKey: this.apiKey, baseURL });
        return remote.embed(input);
    }
}

BaseProvider.register('llama', LlamaProvider);
BaseProvider.register('meta', LlamaProvider);
BaseProvider.register('meta-llama', LlamaProvider);
export { LlamaProvider };
