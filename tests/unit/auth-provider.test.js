import { describe, expect, test, jest } from '@jest/globals';
import { extractBearer, resolveUser, requireUser } from '../../src/api/middleware/auth-provider.js';

describe('shared Supabase API auth boundary', () => {
  const saved = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_PUBLISHABLE_KEY,
    anon: process.env.SUPABASE_ANON_KEY,
    fetch: global.fetch
  };

  afterEach(() => {
    if (saved.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = saved.key;
    if (saved.anon === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = saved.anon;
    global.fetch = saved.fetch;
  });

  test('extracts standard and lower-case bearer schemes', () => {
    expect(extractBearer({ get: () => 'Bearer access-token' })).toBe('access-token');
    expect(extractBearer({ get: () => 'bearer access-token' })).toBe('access-token');
    expect(extractBearer({ get: () => 'Basic abc' })).toBeNull();
  });

  test('resolves one Supabase user and protected profile without trusting user metadata', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'supabase-user-1',
          email: 'user@example.com',
          email_confirmed_at: '2026-01-01T00:00:00.000Z',
          app_metadata: {},
          user_metadata: { role: 'admin', full_name: 'Example User' }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ role: 'partner', tenant_id: 'tenant-1', site_id: 'site-1', domain: 'wifi' }]
      });

    const user = await resolveUser({ get: () => 'Bearer verified-token' });
    expect(user).toMatchObject({
      id: 'supabase-user-1',
      role: 'partner',
      tenantId: 'tenant-1',
      siteId: 'site-1',
      domainId: 'wifi',
      authProvider: 'supabase',
      emailVerified: true
    });
    expect(user.role).not.toBe('admin');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('rejects invalid tokens before calling downstream handlers', async () => {
    const req = { get: () => '' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    await requireUser(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
