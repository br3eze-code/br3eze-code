import { describe, expect, test, jest } from '@jest/globals';
import { authenticateBearer, issueUserToken, hasPermission, ownsResource, normalizeIdentity } from './identity.js';

describe('canonical identity authorization', () => {
  test('issues and verifies short-lived signed user tokens without exposing the signing secret', async () => {
    const secret = 'test-signing-secret-that-is-long-enough';
    const token = issueUserToken({ uid: 'user-123', username: 'test-user', role: 'PARTNER' }, secret);
    expect(token).not.toBe(secret);
    const identity = await authenticateBearer(token, { userTokenSecret: secret });
    expect(identity.id).toBe('user-123');
    expect(identity.provider).toBe('local');
    expect(identity.roles).toContain('PARTNER');
    expect(identity.permissions).toContain('orders.create');
    expect(await authenticateBearer(token, { userTokenSecret: 'different-long-secret-value' })).toBeNull();
  });

  test('rejects short signing secrets and malformed user tokens', async () => {
    expect(() => issueUserToken({ uid: 'u1', role: 'USER' }, 'short')).toThrow(/16 characters/);
    expect(await authenticateBearer('not-a-token', { userTokenSecret: 'test-signing-secret-that-is-long-enough' })).toBeNull();
  });

  test('verifies Supabase access tokens and trusts only server-controlled role metadata', async () => {
    const previous = {
      url: process.env.SUPABASE_URL,
      anon: process.env.SUPABASE_ANON_KEY,
      fetch: global.fetch,
    };
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'test-anon-key';
    global.fetch = jest.fn(async (url, options) => ({
      ok: true,
      json: async () => ({
        id: 'supabase-user-1',
        email: 'user@example.com',
        email_confirmed_at: '2026-01-01T00:00:00.000Z',
        app_metadata: { role: 'PARTNER', tenant_id: 'tenant-1' },
        user_metadata: { role: 'ADMIN' },
      }),
    }));
    try {
      const identity = await authenticateBearer('valid-supabase-token');
      expect(identity.provider).toBe('supabase');
      expect(identity.id).toBe('supabase-user-1');
      expect(identity.roles).toEqual(['PARTNER']);
      expect(identity.tenantId).toBe('tenant-1');
      expect(identity.roles).not.toContain('ADMIN');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.supabase.co/auth/v1/user',
        expect.objectContaining({
          headers: expect.objectContaining({
            apikey: 'test-anon-key',
            authorization: 'Bearer valid-supabase-token',
          }),
        }),
      );
    } finally {
      if (previous.url === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = previous.url;
      if (previous.anon === undefined) delete process.env.SUPABASE_ANON_KEY;
      else process.env.SUPABASE_ANON_KEY = previous.anon;
      global.fetch = previous.fetch;
    }
  });

  test('normalizes a Firebase identity', () => {
    const identity = normalizeIdentity({ uid: 'u1', email: 'u@example.com', role: 'PARTNER' });
    expect(identity.id).toBe('u1');
    expect(identity.provider).toBe('firebase');
    expect(identity.roles).toContain('PARTNER');
    expect(hasPermission(identity, 'orders.create')).toBe(true);
    expect(hasPermission(identity, 'system.reboot')).toBe(false);
  });

  test('admin has wildcard permissions and ownership', () => {
    const identity = normalizeIdentity({ uid: 'a1', role: 'ADMIN' });
    expect(hasPermission(identity, 'anything')).toBe(true);
    expect(ownsResource(identity, 'another-user')).toBe(true);
  });

  test('normal users cannot access another user resource', () => {
    const identity = normalizeIdentity({ uid: 'u1', role: 'USER' });
    expect(ownsResource(identity, 'u1')).toBe(true);
    expect(ownsResource(identity, 'u2')).toBe(false);
  });
});
