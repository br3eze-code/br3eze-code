// src/domains/ai/index.js
import BaseDomain from '../BaseDomain.js';
import { ClaudeProvider } from '../../providers/claude.js';

class AIDomain extends BaseDomain {
  constructor() {
    super();
    this.name = 'ai';
    
    this.registerTool({
      name: 'status',
      description: 'Check status and validity of configured AI providers',
      execute: async () => {
        const providers = [];
        import { OpenAIProvider } from '../../providers/openai.js';
        import GeminiProvider from '../../providers/gemini.js';
        import { OllamaProvider } from '../../providers/ollama.js';

        // Helper to check provider
        const checkProvider = async (name, ProviderClass, envKey) => {
          if (process.env[envKey] || name === 'Ollama') {
            try {
              const provider = new ProviderClass();
              const result = await provider.validateKey();
              return { name, configured: true, valid: result.valid, error: result.error };
            } catch (e) {
              return { name, configured: true, valid: false, error: e.message };
            }
          }
          return { name, configured: false };
        };

        providers.push(await checkProvider('Anthropic', ClaudeProvider, 'ANTHROPIC_API_KEY'));
        providers.push(await checkProvider('OpenAI', OpenAIProvider, 'OPENAI_API_KEY'));
        providers.push(await checkProvider('Gemini', GeminiProvider, 'GEMINI_API_KEY'));
        providers.push(await checkProvider('Ollama', OllamaProvider, 'OLLAMA_MODEL'));

        return providers;
      }
    });

    this.registerTool({
      name: 'verify',
      description: 'Verify if a specific AI provider key is working',
      execute: async (provider = 'anthropic') => {
        const p = provider.toLowerCase();
        if (p === 'anthropic') {
           const claude = new ClaudeProvider();
           return await claude.validateKey();
        } else if (p === 'openai') {
           import { OpenAIProvider } from '../../providers/openai.js';
           const openai = new OpenAIProvider();
           return await openai.validateKey();
        } else if (p === 'gemini') {
           import GeminiProvider from '../../providers/gemini.js';
           const gemini = new GeminiProvider();
           return await gemini.validateKey();
        } else if (p === 'ollama') {
           import { OllamaProvider } from '../../providers/ollama.js';
           const ollama = new OllamaProvider();
           return await ollama.validateKey();
        }
        return { success: false, error: `Provider ${provider} not supported for verification yet.` };
      }
    });
  }
}

export default AIDomain;
