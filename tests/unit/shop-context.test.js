import { describe, expect, test } from '@jest/globals';
import { resolveCommerceContext } from '../../src/api/routes/shop-context.js';

function request({ uid, role, tenantId, siteId, domain, platform, channelId } = {}) {
  return {
    firebaseUser: uid ? { uid, role, tenantId, siteId, domain, customClaims: {} } : undefined,
    body: { platform, channelId },
    query: {},
  };
}

describe('shop commerce context security boundary', () => {
  test('requires Firebase identity', () => {
    expect(() => resolveCommerceContext(request())).toThrow('Firebase identity required');
  });
  test('requires tenant scope by default', () => {
    expect(() => resolveCommerceContext(request({ uid: 'user-1' }))).toThrow('Tenant scope required');
  });
  test('derives merchant and scope from authenticated identity', () => {
    expect(resolveCommerceContext(request({ uid: 'user-1', tenantId: 'merchant-1', siteId: 'site-1', domain: 'shop.example', platform: 'web' }))).toMatchObject({
      uid: 'user-1', buyerId: 'user-1', merchantId: 'merchant-1', platform: 'web', channelId: 'user-1',
      scope: { tenantId: 'merchant-1', siteId: 'site-1', domain: 'shop.example' },
    });
  });
  test('never trusts a caller-supplied channelId as ownership', () => {
    const context = resolveCommerceContext(request({ uid: 'real-user', tenantId: 'merchant-1', channelId: 'victim-user' }));
    expect(context.buyerId).toBe('real-user');
    expect(context.channelId).toBe('real-user');
    expect(context.requestedChannelId).toBe('victim-user');
  });
  test('accepts tenant, site, domain and role from custom claims', () => {
    const req = { firebaseUser: { uid: 'user-3', customClaims: { tenantId: 'merchant-2', siteId: 'site-2', domainId: 'shop-2.example', role: 'partner' } }, body: {}, query: {} };
    expect(resolveCommerceContext(req)).toMatchObject({ uid: 'user-3', merchantId: 'merchant-2', platform: 'web', channelId: 'user-3', role: 'partner', scope: { tenantId: 'merchant-2', siteId: 'site-2', domain: 'shop-2.example' } });
  });
  test('defaults an omitted platform to web', () => {
    expect(resolveCommerceContext(request({ uid: 'user-4', tenantId: 'merchant-3' })).platform).toBe('web');
  });
  test('rejects an empty platform', () => {
    expect(() => resolveCommerceContext(request({ uid: 'user-5', tenantId: 'merchant-3', platform: '   ' }))).toThrow('platform required');
  });
  test('can operate without tenant only when explicitly configured by the host', () => {
    const context = resolveCommerceContext(request({ uid: 'user-6', platform: 'web' }), { requireTenant: false });
    expect(context.merchantId).toBeNull();
    expect(context.channelId).toBe('user-6');
  });
});
