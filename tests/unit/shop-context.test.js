import { describe, expect, test } from '@jest/globals';
import { resolveCommerceContext } from '../../src/api/routes/shop-context.js';

function request({ uid, role, tenantId, siteId, domain, platform, channelId } = {}) {
  return {
    firebaseUser: uid ? {
      uid,
      role,
      tenantId,
      siteId,
      domain,
      customClaims: {},
    } : undefined,
    body: { platform, channelId },
    query: {},
  };
}

describe('shop commerce context security boundary', () => {
  test('requires Firebase identity', () => {
    expect(() => resolveCommerceContext(request())).toThrow('Firebase identity required');
    try {
      resolveCommerceContext(request());
    } catch (error) {
      expect(error.status).toBe(401);
    }
  });

  test('requires tenant scope by default', () => {
    expect(() => resolveCommerceContext(request({ uid: 'user-1' }))).toThrow('Tenant scope required');
    try {
      resolveCommerceContext(request({ uid: 'user-1' }));
    } catch (error) {
      expect(error.status).toBe(403);
    }
  });

  test('derives merchant and scope from authenticated identity', () => {
    const context = resolveCommerceContext(request({
      uid: 'user-1',
      tenantId: 'merchant-1',
      siteId: 'site-1',
      domain: 'shop.example',
      platform: 'web',
    }));

    expect(context).toMatchObject({
      uid: 'user-1',
      buyerId: 'user-1',
      merchantId: 'merchant-1',
      platform: 'web',
      channelId: 'user-1',
      scope: {
        tenantId: 'merchant-1',
        siteId: 'site-1',
        domain: 'shop.example',
      },
    });
  });

  test('never trusts a caller-supplied uid or channelId as ownership', () => {
    const context = resolveCommerceContext(request({
      uid: 'real-user',
      tenantId: 'merchant-1',
      platform: 'web',
      channelId: 'victim-user',
    }));

    expect(context.buyerId).toBe('real-user');
    expect(context.channelId).toBe('real-user');
    expect(context.requestedChannelId).toBe('victim-user');
  });

  test('keeps platform while canonicalizing the user-owned channel', () => {
    const context = resolveCommerceContext(request({
      uid: 'user-2',
      tenantId: 'merchant-1',
      platform: 'whatsapp',
      channelId: 'another-chat',
    }));

    expect(context.platform).toBe('whatsapp');
    expect(context.channelId).toBe('user-2');
  });

  test('accepts tenant, site, domain and role from custom claims', () => {
    const req = {
      firebaseUser: {
        uid: 'user-3',
        customClaims: {
          tenantId: 'merchant-2',
          siteId: 'site-2',
          domainId: 'shop-2.example',
          role: 'partner',
        },
      },
      body: {},
      query: {},
    };

    expect(resolveCommerceContext(req)).toMatchObject({
      uid: 'user-3',
      merchantId: 'merchant-2',
      platform: 'web',
      channelId: 'user-3',
      role: 'partner',
      scope: {
        tenantId: 'merchant-2',
        siteId: 'site-2',
        domain: 'shop-2.example',
      },
    });
  });

  test('defaults an omitted platform to web', () => {
    const context = resolveCommerceContext(request({ uid: 'user-4', tenantId: 'merchant-3' }));
    expect(context.platform).toBe('web');
  });

  test('rejects an empty platform', () => {
    expect(() => resolveCommerceContext(request({ uid: 'user-5', tenantId: 'merchant-3', platform: '   ' })))
      .toThrow('platform required');
  });

  test('can operate without tenant only when explicitly configured by the host', () => {
    const context = resolveCommerceContext(request({ uid: 'user-6', platform: 'web' }), { requireTenant: false });
    expect(context.merchantId).toBeNull();
    expect(context.channelId).toBe('user-6');
  });
});
