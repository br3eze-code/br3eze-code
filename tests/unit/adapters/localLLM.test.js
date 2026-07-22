'use strict';

import { jest } from '@jest/globals';

jest.unstable_mockModule('axios', () => ({
  default: { post: jest.fn() },
}));

const { default: axios } = await import('axios');
const { default: LocalLLMAdapter } = await import('../../../adapters/localLLM.js');

describe('LocalLLMAdapter', () => {
  test('defaults to the standard local gateway endpoint when none is given', () => {
    const adapter = new LocalLLMAdapter();
    expect(adapter.endpoint).toBe('http://localhost:19876');
  });

  test('uses a custom endpoint when provided', () => {
    const adapter = new LocalLLMAdapter('http://192.168.1.50:11434');
    expect(adapter.endpoint).toBe('http://192.168.1.50:11434');
  });

  test('generate() posts to {endpoint}/api/generate with stream:false and a default model', async () => {
    const adapter = new LocalLLMAdapter('http://localhost:19876');
    axios.post.mockResolvedValue({ data: { response: 'hello back' } });

    const result = await adapter.generate('hello');

    expect(axios.post).toHaveBeenCalledWith('http://localhost:19876/api/generate', {
      model: 'llama3',
      prompt: 'hello',
      stream: false,
    });
    expect(result).toEqual({ text: 'hello back', provider: 'local' });
  });

  test('generate() respects an overridden model', async () => {
    const adapter = new LocalLLMAdapter();
    axios.post.mockResolvedValue({ data: { response: 'ok' } });

    await adapter.generate('hi', { model: 'mistral' });

    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ model: 'mistral' })
    );
  });

  test('generate() propagates connection errors (e.g. local gateway not running)', async () => {
    const adapter = new LocalLLMAdapter();
    axios.post.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(adapter.generate('hi')).rejects.toThrow('ECONNREFUSED');
  });
});
