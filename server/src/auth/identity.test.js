import { describe, expect, test, jest } from '@jest/globals';
import { authenticateBearer, hasPermission, ownsResource, normalizeIdentity } from './identity.js';

describe('Supabase identity boundary', () => {
  test('requires a distinct configured service token for service authority', async () => {
    const previous = process.env.AGENTOS_SERVICE_TOKEN;
    process.env.AGENTOS_SERVICE_TOKEN = 'explicit-service-token';
    try {
      expect(await authenticateBearer('explicit-service-token')).toMatchObject({ provider: 'service', permissions: ['*'] });
      expect(await authenticateBearer('not-the-service-token')).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.AGENTOS_SERVICE_TOKEN;
      else process.env.AGENTOS_SERVICE_TOKEN = previous;
    }
  });

  test('verifies Supabase access tokens and trusts only server-controlled role metadata', async () => {
    const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY, anon: process.env.SUPABASE_ANON_KEY, fetch: global.fetch };
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
    delete process.env.SUPABASE_ANON_KEY;
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        id: 'supabase-user-1',
        email: 'user@example.com',
        email_confirmed_at: '2026-01-01T00:00:00.000Z',
        app_metadata: { role: 'PARTNER', tenant_id: 'tenant-1' },
        user_metadata: { role: 'ADMIN' }
      })
    }));
    try {
      const identity = await authenticateBearer('valid-supabase-token');
      expect(identity).toMatchObject({ provider: 'supabase', id: 'supabase-user-1', tenantId: 'tenant-1' });
      expect(identity.roles).toEqual(['PARTNER']);
      expect(identity.roles).not.toContain('ADMIN');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.supabase.co/auth/v1/user',
        expect.objectContaining({ headers: expect.objectContaining({ apikey: 'test-publishable-key', authorization: 'Bearer valid-supabase-token' }) })
      );
    } finally {
      if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
      if (previous.key === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = previous.key;
      if (previous.anon === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = previous.anon;
      global.fetch = previous.fetch;
    }
  });

  test('rejects Firebase/local user tokens as identity credentials', async () => {
    const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY, anon: process.env.SUPABASE_ANON_KEY };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    try {
      expect(await authenticateBearer('firebase-id-token')).toBeNull();
      expect(await authenticateBearer('legacy-local-jwt')).toBeNull();
    } finally {
      if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
      if (previous.key === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = previous.key;
      if (previous.anon === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = previous.anon;
    }
  });

  test('uses explicit role permissions and ownership', () => {
    const identity = normalizeIdentity({ uid: 'partner-1', email: 'p@example.com', role: 'PARTNER' });
    expect(identity.provider).toBe('supabase');
    expect(hasPermission(identity, 'orders.create')).toBe(true);
    expect(hasPermission(identity, 'system.reboot')).toBe(false);
    expect(ownsResource(identity, 'partner-1')).toBe(true);
    expect(ownsResource(identity, 'another-user')).toBe(false);
  });

  test('admin authority comes only from the trusted server-side role input', () => {
    const identity = normalizeIdentity({ uid: 'admin-1', role: 'ADMIN' });
    expect(hasPermission(identity, 'anything')).toBe(true);
    expect(ownsResource(identity, 'another-user')).toBe(true);
  });
});
