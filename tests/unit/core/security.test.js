import SecurityManager from '../../../src/core/security.js';

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
