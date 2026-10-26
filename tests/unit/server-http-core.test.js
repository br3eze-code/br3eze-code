import { describe, expect, test, jest } from '@jest/globals';
import { configureHttpApplication } from '../../server/src/core/configureHttpApplication.js';

describe('configureHttpApplication', () => {
  test('composes only shared HTTP middleware and returns the app', () => {
    const app = { use: jest.fn() };
    const express = Object.assign(jest.fn(() => app), {
      json: jest.fn(() => 'json-middleware'),
      static: jest.fn(() => 'static-middleware')
    });
    const helmet = jest.fn(() => 'helmet-middleware');
    const cors = jest.fn(() => 'cors-middleware');

    const result = configureHttpApplication({
      express,
      helmet,
      cors,
      staticDirectory: '/tmp/agentos-public'
    });

    expect(result).toBe(app);
    expect(helmet).toHaveBeenCalledWith(expect.objectContaining({
      contentSecurityPolicy: expect.any(Object)
    }));
    expect(cors).toHaveBeenCalledTimes(1);
    expect(express.json).toHaveBeenCalledWith({ limit: '10mb' });
    expect(express.static).toHaveBeenCalledWith('/tmp/agentos-public');
    expect(app.use).toHaveBeenCalledTimes(4);
  });

  test('rejects missing domain-neutral composition dependencies', () => {
    expect(() => configureHttpApplication({})).toThrow(TypeError);
    expect(() => configureHttpApplication({
      express: Object.assign(() => ({ use: jest.fn() }), {
        json: () => 'json-middleware',
        static: () => 'static-middleware'
      }),
      helmet: () => {},
      cors: () => {},
      staticDirectory: ''
    })).toThrow(/static directory/);
  });
});
