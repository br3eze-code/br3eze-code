import { describe, expect, test, jest } from '@jest/globals';
import { createProviderModelPort } from '../../src/adapters/models/provider-model-port.js';

describe('provider model port adapter', () => {
  test('translates the runtime request and normalizes provider output', async () => {
    const provider = {
      generate: jest.fn().mockResolvedValue({
        text: 'answer',
        calls: [{ id: 'call-1', name: 'math.add', args: { a: 1, b: 2 } }],
        usage: { inputTokens: 8, outputTokens: 2 },
      }),
    };
    const model = createProviderModelPort({ provider });
    const result = await model.execute({
      messages: [{ role: 'user', content: 'add 1 and 2' }],
      tools: [{ name: 'math.add', description: 'Add numbers' }],
      context: { tenantId: 't1' },
    });

    expect(provider.generate).toHaveBeenCalledWith(
      [{ role: 'user', content: 'add 1 and 2' }],
      [{ name: 'math.add', description: 'Add numbers', parameters: { type: 'object', properties: {} } }],
      { tenantId: 't1' },
    );
    expect(result).toMatchObject({
      content: 'answer',
      toolCalls: [{ id: 'call-1', name: 'math.add', arguments: { a: 1, b: 2 } }],
      usage: { inputTokens: 8, outputTokens: 2 },
    });
  });

  test('preserves system prompt context and exposes provider identity', async () => {
    const provider = {
      name: 'test',
      generate: jest.fn().mockResolvedValue({ content: 'ok' }),
    };
    const model = createProviderModelPort({ provider });

    await model.execute({
      messages: [{ role: 'user', content: 'hello' }],
      context: { systemPrompt: 'Be concise.' },
    });

    expect(model.providerName).toBe('test');
    expect(provider.generate.mock.calls[0][0]).toEqual([
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'hello' },
    ]);
  });

  test('merges the request system prompt with existing system messages', async () => {
    const provider = { generate: jest.fn().mockResolvedValue({ content: 'ok' }) };
    const model = createProviderModelPort({ provider });

    await model.execute({
      messages: [
        { role: 'system', content: 'Existing system context.' },
        { role: 'user', content: 'hello' },
      ],
      context: { systemPrompt: 'Request-specific system context.' },
    });

    expect(provider.generate.mock.calls[0][0]).toEqual([
      { role: 'system', content: 'Request-specific system context.\n\nExisting system context.' },
      { role: 'user', content: 'hello' },
    ]);
  });


  test('parses provider JSON arguments and fails closed on malformed arguments', async () => {
    const model = createProviderModelPort({
      provider: { generate: async () => ({ toolCalls: [{ name: 'safe.echo', arguments: JSON.stringify({ value: 'ok' }) }] }) },
    });
    await expect(model.execute({})).resolves.toMatchObject({
      toolCalls: [{ name: 'safe.echo', arguments: { value: 'ok' } }],
    });
    const malformed = createProviderModelPort({
      provider: { generate: async () => ({ toolCalls: [{ name: 'safe.echo', arguments: 'not-json' }] }) },
    });
    await expect(malformed.execute({})).rejects.toThrow(/invalid JSON tool arguments/i);
  });

  test('accepts OpenAI-style function calls and rejects missing providers', async () => {
    const model = createProviderModelPort({
      provider: {
        generate: async () => ({
          content: '',
          toolCalls: [{ id: 'c2', function: { name: 'test.echo', arguments: JSON.stringify({ value: 'ok' }) } }],
        }),
      },
    });

    await expect(model.execute({ tools: [{ type: 'function', function: { name: 'test.echo' } }] }))
      .resolves.toMatchObject({
        toolCalls: [{ id: 'c2', name: 'test.echo', arguments: { value: 'ok' } }],
      });
    expect(() => createProviderModelPort()).toThrow(/provider must implement generate/i);
  });
});
