import { describe, expect, test } from '@jest/globals';
import { createConfiguredProviderModelPort } from '../../src/adapters/models/configured-provider.js';

describe('configured provider composition', () => {
  test('uses the configured primary provider when credentials exist', async () => {
    const model = await createConfiguredProviderModelPort({
      config: { llm: { primary: 'openai', fallbacks: ['gemini'] } },
      env: { OPENAI_API_KEY: 'test-openai-key', GEMINI_API_KEY: 'test-gemini-key' },
    });

    expect(model.providerName).toBe('openai');
  });

  test('falls back to the first configured provider without changing AgentRuntime', async () => {
    const model = await createConfiguredProviderModelPort({
      config: { llm: { primary: 'openai', fallbacks: ['gemini', 'ollama'] } },
      env: { GEMINI_API_KEY: 'test-gemini-key' },
    });

    expect(model.providerName).toBe('gemini');
  });

  test('does not silently configure an unavailable remote or local provider', async () => {
    await expect(createConfiguredProviderModelPort({
      config: { llm: { primary: 'openai', fallbacks: ['gemini', 'ollama'] } },
      env: {},
    })).resolves.toBeNull();
  });

  test('honors an explicit provider selection over the configured default', async () => {
    const model = await createConfiguredProviderModelPort({
      config: { llm: { primary: 'openai', fallbacks: [] } },
      env: { LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-gemini-key' },
    });

    expect(model.providerName).toBe('gemini');
  });
});
