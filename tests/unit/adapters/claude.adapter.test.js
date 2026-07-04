'use strict';

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn(),
      stream: jest.fn(),
    },
  }));
});

const Anthropic = require('@anthropic-ai/sdk');
const ClaudeAdapter = require('../../../adapters/claude.adapter');

describe('ClaudeAdapter', () => {
  let adapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new ClaudeAdapter('fake-api-key');
  });

  test('constructs the underlying Anthropic client with the given api key', () => {
    expect(Anthropic).toHaveBeenCalledWith({ apiKey: 'fake-api-key' });
  });

  test('generate() sends the prompt as a single user message with sane defaults', async () => {
    adapter.client.messages.create.mockResolvedValue({
      content: [{ text: 'hello back' }],
    });

    const result = await adapter.generate('hello');

    expect(adapter.client.messages.create).toHaveBeenCalledWith({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(result).toEqual({ text: 'hello back', provider: 'claude' });
  });

  test('generate() respects an overridden model and max_tokens', async () => {
    adapter.client.messages.create.mockResolvedValue({
      content: [{ text: 'ok' }],
    });

    await adapter.generate('hi', { model: 'claude-opus-4-1', max_tokens: 50 });

    expect(adapter.client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-opus-4-1', max_tokens: 50 })
    );
  });

  test('generate() propagates errors from the SDK instead of swallowing them', async () => {
    adapter.client.messages.create.mockRejectedValue(new Error('rate limited'));
    await expect(adapter.generate('hi')).rejects.toThrow('rate limited');
  });

  test('generateStream() delegates to client.messages.stream with the same shape', async () => {
    const fakeStream = { on: jest.fn() };
    adapter.client.messages.stream.mockReturnValue(fakeStream);

    const result = await adapter.generateStream('hi', { model: 'claude-sonnet-4-5' });

    expect(adapter.client.messages.stream).toHaveBeenCalledWith({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result).toBe(fakeStream);
  });

  test('unimplemented generation modes throw a clear "must implement" error via BaseAdapter', async () => {
    await expect(adapter.generateImage('a cat')).rejects.toThrow(
      'claude must implement generateImage()'
    );
    await expect(adapter.generateAudio('hi')).rejects.toThrow(
      'claude must implement generateAudio()'
    );
  });
});
