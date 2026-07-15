'use strict';

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../../src/providers/claude.js', () => ({
  ClaudeProvider: jest.fn().mockImplementation(() => ({
    validateKey: jest.fn().mockResolvedValue({ valid: true }),
  })),
}));
jest.unstable_mockModule('../../../src/providers/openai.js', () => ({
  OpenAIProvider: jest.fn().mockImplementation(() => ({
    validateKey: jest.fn().mockResolvedValue({ valid: true }),
  })),
}));
jest.unstable_mockModule('../../../src/providers/gemini.js', () => ({
  default: jest.fn().mockImplementation(() => ({
    validateKey: jest.fn().mockResolvedValue({ valid: false, error: 'bad key' }),
  })),
}));
jest.unstable_mockModule('../../../src/providers/ollama.js', () => ({
  OllamaProvider: jest.fn().mockImplementation(() => ({
    validateKey: jest.fn().mockResolvedValue({ valid: true }),
  })),
}));

const { ClaudeProvider } = await import('../../../src/providers/claude.js');
const { OpenAIProvider } = await import('../../../src/providers/openai.js');
const { default: AIDomain } = await import('../../../src/domains/ai/index.js');

describe('AIDomain', () => {
  let domain;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    domain = new AIDomain();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('registers status and verify tools', () => {
    expect(domain.getSkills().map(t => t.name).sort()).toEqual(['status', 'verify']);
  });

  describe('status()', () => {
    test('reports configured:false for providers with no API key set', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.OLLAMA_MODEL;

      const result = await domain.execute({ tool: 'status', params: undefined });
      const anthropic = result.find(p => p.name === 'Anthropic');
      expect(anthropic).toEqual({ name: 'Anthropic', configured: false });
    });

    test('reports configured:true and validity for a provider with its key set', async () => {
      process.env.ANTHROPIC_API_KEY = 'fake-key';

      const result = await domain.execute({ tool: 'status', params: undefined });
      const anthropic = result.find(p => p.name === 'Anthropic');
      expect(anthropic).toEqual({
        name: 'Anthropic',
        configured: true,
        valid: true,
        error: undefined,
      });
    });

    test('Ollama is always checked regardless of an API key env var', async () => {
      delete process.env.OLLAMA_MODEL;
      const result = await domain.execute({ tool: 'status', params: undefined });
      const ollama = result.find(p => p.name === 'Ollama');
      expect(ollama.configured).toBe(true);
    });

    test('reports valid:false with the error message when validateKey rejects', async () => {
      process.env.OPENAI_API_KEY = 'fake-key';
      OpenAIProvider.mockImplementationOnce(() => ({
        validateKey: jest.fn().mockRejectedValue(new Error('network error')),
      }));

      const result = await domain.execute({ tool: 'status', params: undefined });
      const openai = result.find(p => p.name === 'OpenAI');
      expect(openai).toEqual({ name: 'OpenAI', configured: true, valid: false, error: 'network error' });
    });
  });

  describe('verify()', () => {
    test('defaults to the anthropic provider when none is specified', async () => {
      const result = await domain.execute({ tool: 'verify', params: undefined });
      expect(ClaudeProvider).toHaveBeenCalled();
      expect(result).toEqual({ valid: true });
    });

    test('is case-insensitive when matching the requested provider', async () => {
      await domain.execute({ tool: 'verify', params: 'OpenAI' });
      expect(OpenAIProvider).toHaveBeenCalled();
    });

    test('returns a clear unsupported-provider error for an unknown provider name', async () => {
      const result = await domain.execute({ tool: 'verify', params: 'grok' });
      expect(result).toEqual({
        success: false,
        error: 'Provider grok not supported for verification yet.',
      });
    });
  });
});
