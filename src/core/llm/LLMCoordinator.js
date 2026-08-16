import { logger } from '../logger.js';
import { BaseProvider } from './providers/BaseProvider.js';

import HookRegistry from './hooks.js';

// Importing each provider module runs its BaseProvider.register(...) side
// effect, populating the registry before LLMCoordinator's constructor runs.
import './providers/AnthropicProvider.js';
import './providers/DeepSeekProvider.js';
import './providers/GeminiProvider.js';
import './providers/GemmaProvider.js';
import './providers/GroqProvider.js';
import './providers/LlamaProvider.js';
import './providers/MiniMaxProvider.js';
import './providers/MoonshotProvider.js';
import './providers/NanoAIProvider.js';
import './providers/OllamaProvider.js';

import './providers/OpenAIProvider.js';
import './providers/OpenRouterProvider.js';
import './providers/TogetherAIProvider.js';
import './providers/XAIProvider.js';

/**
 * LLM Coordinator — Orchestrates multiple LLM providers
 */


class LLMCoordinator {
    constructor(providerType = process.env.LLM_PROVIDER || 'gemini', config = {}) {
        this.providerType = providerType;
        this.provider = this.createProvider(providerType, config);
        this.hooks = config.hooks || new HookRegistry();
    }

    createProvider(type, config = {}) {
        try {
            // Handle tiered selection
            if (type.startsWith('tier-')) {
                const tier = parseInt(type.split('-')[1]);
                const resolution = this.resolveTier(tier);
                type = resolution.provider;
                config.model = resolution.model;
            }

            const registry = BaseProvider.getRegistry();
            const ProviderClass = registry[type.toLowerCase()];

            if (!ProviderClass) {
                logger.warn(`Unknown LLM provider: ${type}, defaulting to gemini`);
                return new registry['gemini'](config);
            }

            return new ProviderClass(config);
        } catch (err) {
            logger.error(`Failed to create LLM provider ${type}: ${err.message}`);
            throw err;
        }
    }

    resolveTier(tier) {
        switch (tier) {
            case 1: // Best/Large
                return {
                    provider: process.env.TIER1_PROVIDER || 'gemini',
                    model: process.env.TIER1_MODEL || 'gemini-1.5-pro'
                };
            case 2: // Balanced/Flash
                return {
                    provider: process.env.TIER2_PROVIDER || 'gemini',
                    model: process.env.TIER2_MODEL || 'gemini-2.0-flash'
                };
            case 3: // Small/Open
                return {
                    provider: process.env.TIER3_PROVIDER || 'together',
                    model: process.env.TIER3_MODEL || 'mistralai/Mixtral-8x7B-Instruct-v0.1'
                };
            default:
                return {
                    provider: 'gemini',
                    model: 'gemini-1.5-flash'
                };
        }
    }

    async initialize() {
        return this.provider.initialize();
    }

    /**
     * @param {Array|string} messages - Conversation history or single prompt
     * @param {Object} options - Generation options (tools, temperature, etc)
     */
    async generate(messages, options = {}) {
        // Convert single string prompt to messages format if needed
        const msgs = typeof messages === 'string'
            ? [{ role: 'user', content: messages }]
            : messages;

        await this.hooks.trigger('pre_llm', { messages: msgs, options });

        try {
            const result = await this.provider.generate(msgs, options.tools || []);
            await this.hooks.trigger('post_llm', { messages: msgs, result });
            return result;
        } catch (err) {
            // Fallback to Anthropic/Claude on quota or rate-limit errors
            const isQuotaErr = err.message && (err.message.includes('429') || err.message.includes('quota') || err.message.includes('rate'));
            const fallbackKey = process.env.ANTHROPIC_API_KEY;
            if (isQuotaErr && fallbackKey && this.providerType !== 'anthropic') {
                logger.warn(`Primary provider (${this.providerType}) quota hit — falling back to Claude`);
                try {
                    const fallback = this.createProvider('anthropic', { apiKey: fallbackKey });
                    await fallback.initialize();
                    const result = await fallback.generate(msgs, options.tools || []);
                    await this.hooks.trigger('post_llm', { messages: msgs, result });
                    return result;
                } catch (fallbackErr) {
                    logger.error(`Claude fallback also failed: ${fallbackErr.message}`);
                }
            }
            await this.hooks.trigger('llm_error', { messages: msgs, error: err });
            throw err;
        }
    }

    async classify(text, categories) {
        const prompt = `Classify the following text into one of these categories: ${categories.join(', ')}\n\nText: "${text}"\n\nRespond with only the category name.`;
        const result = await this.generate(prompt);
        return result.text.trim().toLowerCase();
    }

    async extractEntities(text, schema) {
        const prompt = `Extract entities from the following text according to this schema:\n${JSON.stringify(schema, null, 2)}\n\nText: "${text}"\n\nRespond with JSON only.`;
        const result = await this.generate(prompt);
        try {
            return JSON.parse(result.text);
        } catch (err) {
            logger.error(`Failed to parse entity extraction result: ${err.message}`);
            return {};
        }
    }

    /**
     * Generate embeddings for the given input
     * @param {string|string[]} input
     */
    async embed(input) {
        if (typeof this.provider.embed !== 'function') {
            throw new Error(`Provider ${this.providerType} does not support embeddings`);
        }
        return this.provider.embed(input);
    }
}

export default LLMCoordinator;
