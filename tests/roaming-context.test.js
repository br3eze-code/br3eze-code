import { resolveRoamingContext, RoamingContextError } from '../src/core/roaming-context.js';

describe('roaming context resolver', () => {
  const context = {
    tenantId: 'tenant-a',
    tenantIds: ['tenant-a', 'tenant-b'],
    siteIds: ['site-a', 'site-b'],
    nodeIds: ['router-a', 'router-b'],
    roamingSessionId: 'roam-1'
  };

  test('resolves an authorized tenant, site, and router selection', () => {
    const result = resolveRoamingContext({ context, selection: { tenantId: 'tenant-b', siteId: 'site-b', nodeId: 'router-b', source: 'telegram' } });
    expect(result.activeTenantId).toBe('tenant-b');
    expect(result.activeSiteId).toBe('site-b');
    expect(result.activeNodeId).toBe('router-b');
    expect(result.selectionSource).toBe('telegram');
  });

  test('requires explicit selections when the authorized scope is ambiguous', () => {
    expect(() => resolveRoamingContext({ context })).toThrow(expect.objectContaining({ code: 'ROAMING_SITE_SELECTION_REQUIRED' }));
  });

  test('rejects a cross-tenant or cross-router selection', () => {
    expect(() => resolveRoamingContext({ context, selection: { tenantId: 'tenant-c' } })).toThrow(
      expect.objectContaining({ code: 'ROAMING_SCOPE_DENIED' })
    );
    expect(() => resolveRoamingContext({ context, selection: { tenantId: 'tenant-a', siteId: 'site-a', nodeId: 'router-c' } })).toThrow(RoamingContextError);
  });

  test('rejects expired selections', () => {
    expect(() => resolveRoamingContext({ context: { ...context, tenantIds: ['tenant-a'], siteIds: ['site-a'], nodeIds: ['router-a'] }, selection: { tenantId: 'tenant-a', siteId: 'site-a', nodeId: 'router-a', expiresAt: '2020-01-01T00:00:00Z' } })).toThrow(
      expect.objectContaining({ code: 'ROAMING_SELECTION_EXPIRED' })
    );
  });
});
