'use strict';

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  }));
});

const OpenAI = require('openai');
const OpenAIAdapter = require('../../../adapters/openai.adapter');

describe('OpenAIAdapter', () => {
  let adapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new OpenAIAdapter('fake-api-key');
  });

  test('constructs the underlying OpenAI client with the given api key', () => {
    expect(OpenAI).toHaveBeenCalledWith({ apiKey: 'fake-api-key' });
  });

  test('generate() sends the prompt as a single user message with sane defaults', async () => {
    adapter.client.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: 'hello back' } }],
    });

    const result = await adapter.generate('hello');

    expect(adapter.client.chat.completions.create).toHaveBeenCalledWith({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.7,
    });
    expect(result).toEqual({ text: 'hello back', provider: 'openai' });
  });

  test('generate() respects an overridden model and temperature', async () => {
    adapter.client.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
    });

    await adapter.generate('hi', { model: 'gpt-4o', temperature: 0.2 });

    expect(adapter.client.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o', temperature: 0.2 })
    );
  });

  test('generate() propagates errors from the SDK', async () => {
    adapter.client.chat.completions.create.mockRejectedValue(new Error('quota exceeded'));
    await expect(adapter.generate('hi')).rejects.toThrow('quota exceeded');
  });

  test('generateStream() requests stream:true and returns the raw response', async () => {
    const fakeStream = { [Symbol.asyncIterator]: jest.fn() };
    adapter.client.chat.completions.create.mockResolvedValue(fakeStream);

    const result = await adapter.generateStream('hi');

    expect(adapter.client.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true })
    );
    expect(result).toBe(fakeStream);
  });

  test('unimplemented generation modes throw via BaseAdapter', async () => {
    await expect(adapter.generateVideo('a cat')).rejects.toThrow(
      'openai must implement generateVideo()'
    );
  });
});
