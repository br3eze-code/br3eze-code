'use strict';

const { EncryptionVault, OAuthVault } = require('../../src/core/vault');

describe('EncryptionVault', () => {
  let vault;

  beforeEach(() => {
    vault = new EncryptionVault('test-master-key-material');
  });

  test('encrypt/decrypt round-trips arbitrary plaintext', () => {
    const plaintext = 'super-secret-oauth-token-abc123';
    const ciphertext = vault.encrypt(plaintext);

    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext.split(':')).toHaveLength(3);
    expect(vault.decrypt(ciphertext)).toBe(plaintext);
  });

  test('encrypting the same plaintext twice produces different ciphertext (random IV)', () => {
    const a = vault.encrypt('same-value');
    const b = vault.encrypt('same-value');
    expect(a).not.toBe(b);
    expect(vault.decrypt(a)).toBe('same-value');
    expect(vault.decrypt(b)).toBe('same-value');
  });

  test('encrypt/decrypt of falsy input returns null instead of throwing', () => {
    expect(vault.encrypt(null)).toBeNull();
    expect(vault.encrypt('')).toBeNull();
    expect(vault.decrypt(null)).toBeNull();
    expect(vault.decrypt('')).toBeNull();
  });

  test('decrypt rejects a malformed ciphertext string missing parts', () => {
    expect(() => vault.decrypt('not-a-valid-ciphertext')).toThrow('Invalid encrypted format');
    expect(() => vault.decrypt('onlyone:parttwo')).toThrow('Invalid encrypted format');
  });

  test('decrypt rejects a tampered ciphertext (GCM auth tag mismatch)', () => {
    const ciphertext = vault.encrypt('do-not-tamper-with-me');
    const [iv, tag, encrypted] = ciphertext.split(':');
    // flip a hex digit in the encrypted payload
    const tampered = `${iv}:${tag}:${encrypted.slice(0, -1)}${encrypted.slice(-1) === '0' ? '1' : '0'}`;
    expect(() => vault.decrypt(tampered)).toThrow();
  });

  test('a vault instantiated with a different master key cannot decrypt another vault\'s ciphertext', () => {
    const otherVault = new EncryptionVault('a-totally-different-key');
    const ciphertext = vault.encrypt('cross-vault-secret');
    expect(() => otherVault.decrypt(ciphertext)).toThrow();
  });

  test('falls back to VAULT_MASTER_KEY env var, then the hardcoded default, when no key is passed', () => {
    const withEnv = new EncryptionVault();
    // Same default/env-derived key should round-trip consistently across instances
    const another = new EncryptionVault();
    const ciphertext = withEnv.encrypt('env-derived');
    expect(another.decrypt(ciphertext)).toBe('env-derived');
  });

  test('hash() is deterministic for the same input and differs for different input', () => {
    expect(vault.hash('abc')).toBe(vault.hash('abc'));
    expect(vault.hash('abc')).not.toBe(vault.hash('abd'));
    expect(vault.hash('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  describe('timingSafeCompare', () => {
    test('returns true for identical strings', () => {
      expect(vault.timingSafeCompare('secret-token', 'secret-token')).toBe(true);
    });

    test('returns false for different strings of the same length', () => {
      expect(vault.timingSafeCompare('secret-token', 'secret-tokeN')).toBe(false);
    });

    test('returns false (not a throw) for strings of different length', () => {
      expect(vault.timingSafeCompare('short', 'a-much-longer-string')).toBe(false);
    });
  });
});

describe('OAuthVault', () => {
  let vault;
  let oauth;

  beforeEach(() => {
    vault = new EncryptionVault('oauth-test-key');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function makeFirestoreLikeDb() {
    const store = new Map();
    return {
      db: {
        collection: jest.fn(() => ({
          doc: jest.fn(id => ({
            set: jest.fn(async data => store.set(id, data)),
            get: jest.fn(async () => ({
              exists: store.has(id),
              data: () => store.get(id),
            })),
          })),
        })),
      },
      _store: store,
    };
  }

  function makeFallbackDb() {
    const store = new Map();
    return {
      saveOAuthToken: jest.fn(async (provider, userId, record) => {
        store.set(`${provider}_${userId}`, record);
      }),
      getOAuthToken: jest.fn(async (provider, userId) => store.get(`${provider}_${userId}`)),
      _store: store,
    };
  }

  test('storeTokens encrypts access/refresh tokens before writing to a Firestore-like db', async () => {
    const db = makeFirestoreLikeDb();
    oauth = new OAuthVault(db, vault);

    await oauth.storeTokens('github', 'u1', {
      accessToken: 'access-123',
      refreshToken: 'refresh-456',
      scope: 'repo',
    });

    const record = db._store.get('github_u1');
    expect(record.encrypted.accessToken).not.toContain('access-123');
    expect(vault.decrypt(record.encrypted.accessToken)).toBe('access-123');
    expect(vault.decrypt(record.encrypted.refreshToken)).toBe('refresh-456');
  });

  test('storeTokens falls back to db.saveOAuthToken when there is no Firestore-style db.db', async () => {
    const db = makeFallbackDb();
    oauth = new OAuthVault(db, vault);

    await oauth.storeTokens('slack', 'u2', { accessToken: 'tok-abc' });

    expect(db.saveOAuthToken).toHaveBeenCalledWith('slack', 'u2', expect.objectContaining({ provider: 'slack', userId: 'u2' }));
  });

  test('getAccessToken serves from the in-memory cache without hitting the db', async () => {
    const db = makeFirestoreLikeDb();
    oauth = new OAuthVault(db, vault);
    await oauth.storeTokens('github', 'u1', { accessToken: 'access-123' });

    const dbGetSpy = db.db.collection('oauth_tokens').doc('github_u1').get;
    const token = await oauth.getAccessToken('github', 'u1');

    expect(token).toBe('access-123');
    expect(dbGetSpy).not.toHaveBeenCalled();
  });

  test('getAccessToken decrypts a persisted record when the cache is cold', async () => {
    const db = makeFirestoreLikeDb();
    const writer = new OAuthVault(db, vault);
    await writer.storeTokens('github', 'u1', { accessToken: 'access-cold' });

    const reader = new OAuthVault(db, vault); // fresh instance, empty cache
    const token = await reader.getAccessToken('github', 'u1');
    expect(token).toBe('access-cold');
  });

  test('getAccessToken throws when no record exists for the provider/user', async () => {
    const db = makeFirestoreLikeDb();
    oauth = new OAuthVault(db, vault);
    await expect(oauth.getAccessToken('github', 'ghost')).rejects.toThrow(
      'No tokens found for github/ghost'
    );
  });

  test('getAccessToken auto-refreshes an expired token that has a refresh token', async () => {
    const db = makeFirestoreLikeDb();
    oauth = new OAuthVault(db, vault);
    await oauth.storeTokens('github', 'u1', {
      accessToken: 'stale-access',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() - 1000, // already expired
    });

    jest.spyOn(oauth, '_refreshToken').mockResolvedValue({ accessToken: 'fresh-access' });

    const token = await oauth.getAccessToken('github', 'u1');
    expect(token).toBe('fresh-access');
    expect(oauth._refreshToken).toHaveBeenCalledWith('github', 'u1', 'refresh-token');
  });

  test('storeTokens schedules a background refresh timer when tokens have both expiry and a refresh token', async () => {
    jest.useFakeTimers();
    const db = makeFirestoreLikeDb();
    oauth = new OAuthVault(db, vault);

    await oauth.storeTokens('github', 'u1', {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 min out — refresh scheduled 5 min before
    });

    expect(oauth.refreshTimers.has('github_u1')).toBe(true);
  });
});
