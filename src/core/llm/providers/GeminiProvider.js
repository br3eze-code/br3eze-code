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

module.exports = { GeminiProvider };