import { describe, expect, test, jest } from '@jest/globals';
import { configureHttpApplication } from '../../server/src/core/configureHttpApplication.js';

describe('domain-agnostic HTTP core', () => {
  test('creates an app and installs only cross-cutting middleware', () => {
    const calls = [];
    const app = { use: jest.fn((middleware) => { calls.push(middleware); }) };
    const express = Object.assign(jest.fn(() => app), {
      json: jest.fn((options) => ({ kind: 'json', options })),
      static: jest.fn((directory) => ({ kind: 'static', directory }))
    });
    const helmet = jest.fn((options) => ({ kind: 'helmet', options }));
    const cors = jest.fn(() => ({ kind: 'cors' }));

    const result = configureHttpApplication({
      express, helmet, cors, staticDirectory: '/tmp/public'
    });

    expect(result).toBe(app);
    expect(express).toHaveBeenCalledTimes(1);
    expect(calls.map((middleware) => middleware.kind)).toEqual(['helmet', 'cors', 'json', 'static']);
    expect(calls[2].options).toEqual({ limit: '10mb' });
    expect(calls[3].directory).toBe('/tmp/public');
  });

  test('rejects missing framework dependencies instead of silently creating a partial app', () => {
    expect(() => configureHttpApplication({})).toThrow(TypeError);
  });
});
