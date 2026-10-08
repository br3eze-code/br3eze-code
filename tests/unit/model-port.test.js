import { describe, expect, test } from '@jest/globals';
import { createModelRequest, validateModelPort } from '../../src/core/ports/model.js';

describe('model port', () => {
  test('validates the provider-neutral execution contract', () => {
    const model = { execute: async () => ({ content: 'ok' }) };
    expect(validateModelPort(model)).toBe(model);
    expect(() => validateModelPort({})).toThrow(/execute/);
  });

  test('creates immutable request envelopes', () => {
    const request = createModelRequest({ messages: [{ role: 'user', content: 'hi' }], tools: ['x'], context: { tenantId: 't1' } });
    expect(request.version).toBe('1.0');
    expect(request.messages).toHaveLength(1);
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.messages)).toBe(true);
  });
});
