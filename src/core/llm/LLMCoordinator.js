// src/core/llm/LLMCoordinator.js
class LLMCoordinator {
  constructor(provider = 'gemini', config = {}) {
    this.provider = this.createProvider(provider, config);
  }

  createProvider(type, config) {
    switch (type) {
      case 'gemini':
        return new (require('./providers/GeminiProvider'))(config);
      case 'openai':
        return new (require('./providers/OpenAIProvider'))(config);
      case 'anthropic':
        return new (require('./providers/AnthropicProvider'))(config);
      case 'local':
        return new (require('./providers/LocalProvider'))(config);
      default:
        throw new Error(`Unknown LLM provider: ${type}`);
    }
  }

  async initialize() {
    return this.provider.initialize();
  }

  async generate(prompt, options = {}) {
    return this.provider.generate(prompt, options);
  }

  async classify(text, categories) {
    const prompt = `
Classify the following text into one of these categories: ${categories.join(', ')}

Text: "${text}"

Respond with only the category name.
`;
    const result = await this.generate(prompt, { maxTokens: 50 });
    return result.trim().toLowerCase();
  }

  async extractEntities(text, schema) {
    const prompt = `
Extract entities from the following text according to this schema:
${JSON.stringify(schema, null, 2)}

Text: "${text}"

Respond with JSON only.
`;
    const result = await this.generate(prompt, { 
      maxTokens: 500,
      responseFormat: 'json'
    });
    return JSON.parse(result);
  }
}

// src/core/llm/providers/GeminiProvider.js
const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiProvider {
  constructor(config) {
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY;
    this.model = config.model || 'gemini-2.5-flash';
    this.client = null;
  }

  async initialize() {
    if (!this.apiKey) {
      throw new Error('Gemini API key not configured');
    }
    this.client = new GoogleGenerativeAI(this.apiKey);
  }

  async generate(prompt, options = {}) {
    const model = this.client.getGenerativeModel({ model: this.model });
    
    const generationConfig = {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxTokens || 2048,
      responseMimeType: options.responseFormat === 'json' ? 'application/json' : 'text/plain'
    };

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig
    });

    return result.response.text();
  }
}

module.exports = { LLMCoordinator, GeminiProvider };