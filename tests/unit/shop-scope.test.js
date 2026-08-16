import { cartKey, normalizeScope, scopeMatches } from '../../src/core/shop.js';

describe('tenant-scoped shop state', () => {
  test('cart keys separate tenant, domain, and site state', () => {
    expect(cartKey('telegram', '42')).toBe('telegram:42');
    expect(cartKey('telegram', '42', { tenantId: 'tenant-a', domain: 'network', siteId: 'site-1' }))
      .toBe('telegram:42:tenant-a:network:site-1');
    expect(cartKey('telegram', '42', { tenantId: 'tenant-b', domain: 'network', siteId: 'site-1' }))
      .not.toBe(cartKey('telegram', '42', { tenantId: 'tenant-a', domain: 'network', siteId: 'site-1' }));
  });

  test('scope matching permits global products but rejects conflicting scoped products', () => {
    const scope = { tenantId: 'tenant-a', domain: 'cctv', siteId: 'site-1' };
    expect(scopeMatches({ id: 'global-product' }, scope)).toBe(true);
    expect(scopeMatches({ tenantId: 'tenant-a', domain: 'cctv', siteId: 'site-1' }, scope)).toBe(true);
    expect(scopeMatches({ tenantId: 'tenant-b', domain: 'cctv', siteId: 'site-1' }, scope)).toBe(false);
    expect(normalizeScope({ tenantId: 'tenant-a' })).toEqual({ tenantId: 'tenant-a', domain: null, siteId: null });
  });
});
