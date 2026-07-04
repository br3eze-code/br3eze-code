'use strict';

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({}),
  })),
}));

const GeminiProvider = require('../../src/providers/gemini');

function makeTool(name, overrides = {}) {
  return {
    name,
    description: `desc for ${name}`,
    parameters: [{ name: 'x', required: true }],
    ...overrides,
  };
}

describe('GeminiProvider.formatTools', () => {
  let provider;

  beforeEach(() => {
    provider = new GeminiProvider({ apiKey: 'fake-key', model: 'gemini-1.5-pro' });
  });

  test('formats tools into a single functionDeclarations block', () => {
    const result = provider.formatTools([makeTool('network.ping')]);
    expect(result).toEqual([
      {
        functionDeclarations: [
          {
            name: 'network.ping',
            description: 'desc for network.ping',
            parameters: {
              type: 'object',
              properties: expect.any(Object),
              required: ['x'],
            },
          },
        ],
      },
    ]);
  });

  test('passes through a tool count under the default cap unchanged', () => {
    const tools = Array.from({ length: 50 }, (_, i) => makeTool(`tool.${i}`));
    const result = provider.formatTools(tools);
    expect(result[0].functionDeclarations).toHaveLength(50);
  });

  test('truncates to MAX_TOOLS_PER_REQUEST (default 128) instead of sending an unbounded list', () => {
    const tools = Array.from({ length: 200 }, (_, i) => makeTool(`tool.${i}`));
    const result = provider.formatTools(tools);
    expect(result[0].functionDeclarations).toHaveLength(128);
    expect(result[0].functionDeclarations[0].name).toBe('tool.0');
  });

  test('respects a custom MAX_TOOLS_PER_REQUEST env override', () => {
    const original = process.env.MAX_TOOLS_PER_REQUEST;
    process.env.MAX_TOOLS_PER_REQUEST = '5';
    try {
      const tools = Array.from({ length: 20 }, (_, i) => makeTool(`tool.${i}`));
      const result = provider.formatTools(tools);
      expect(result[0].functionDeclarations).toHaveLength(5);
    } finally {
      if (original === undefined) delete process.env.MAX_TOOLS_PER_REQUEST;
      else process.env.MAX_TOOLS_PER_REQUEST = original;
    }
  });
});
