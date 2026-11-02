import { SecurityManager } from '../../../src/core/security.js';

describe('SecurityManager encryption', () => {
  test('AES-GCM round trips plaintext and uses a fresh IV', () => {
    const security = new SecurityManager();
    const first = security.encrypt('agentos-secret');
    const second = security.encrypt('agentos-secret');

    expect(first).not.toBe(second);
    expect(security.decrypt(first)).toBe('agentos-secret');
    expect(security.decrypt(second)).toBe('agentos-secret');
  });

  test('rejects malformed ciphertext', () => {
    const security = new SecurityManager();
    expect(() => security.decrypt('not-valid')).toThrow('Invalid encrypted data format');
  });
});

describe('SecurityManager production and audit boundaries', () => {
  test('refuses ephemeral encryption keys in production', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousKey = process.env.AGENTOS_MASTER_KEY;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.AGENTOS_MASTER_KEY;
      expect(() => new SecurityManager()).toThrow('AGENTOS_MASTER_KEY is required in production');
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousKey === undefined) delete process.env.AGENTOS_MASTER_KEY;
      else process.env.AGENTOS_MASTER_KEY = previousKey;
    }
  });

  test('redacts nested credentials and handles cycles without leaking values', () => {
    const security = new SecurityManager();
    const body = { profile: { displayName: 'Operator', api_key: 'private-token-123' }, items: [{ session_cookie: 'cookie-value-456' }] };
    body.self = body;
    const sanitized = security.sanitizeBody(body);
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain('private-token-123');
    expect(serialized).not.toContain('cookie-value-456');
    expect(sanitized.profile.displayName).toBe('Operator');
    expect(sanitized.self).toBe('[CIRCULAR]');
  });
});
