'use strict';

jest.mock('axios');
const axios = require('axios');
const GeminiAdapter = require('../../../adapters/gemini.adapter');

describe('GeminiAdapter', () => {
  let adapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new GeminiAdapter('fake-api-key');
  });

  test('generate() posts to the default model endpoint with the api key as a query param', async () => {
    axios.post.mockResolvedValue({
      data: { candidates: [{ content: { parts: [{ text: 'hello back' }] } }] },
    });

    const result = await adapter.generate('hello');

    expect(axios.post).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=fake-api-key',
      { contents: [{ parts: [{ text: 'hello' }] }] }
    );
    expect(result).toEqual({ text: 'hello back', provider: 'gemini' });
  });

  test('generate() respects an overridden model in the endpoint URL', async () => {
    axios.post.mockResolvedValue({
      data: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
    });

    await adapter.generate('hi', { model: 'gemini-2.0-flash' });

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('models/gemini-2.0-flash:generateContent'),
      expect.anything()
    );
  });

  test('generate() returns an empty string instead of throwing when candidates are missing', async () => {
    axios.post.mockResolvedValue({ data: {} });

    const result = await adapter.generate('hi');

    expect(result).toEqual({ text: '', provider: 'gemini' });
  });

  test('generate() returns an empty string when the response is blocked/empty parts array', async () => {
    axios.post.mockResolvedValue({
      data: { candidates: [{ content: { parts: [] } }] },
    });

    const result = await adapter.generate('hi');
    expect(result.text).toBe('');
  });

  test('generate() propagates network/API errors', async () => {
    axios.post.mockRejectedValue(new Error('network timeout'));
    await expect(adapter.generate('hi')).rejects.toThrow('network timeout');
  });
});
