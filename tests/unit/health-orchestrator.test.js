import { HealthCheckOrchestrator, HealthPollingCoordinator, HealthTargetRegistry } from '../../src/core/health/health-orchestrator.js';

describe('multi-tenant health orchestration', () => {
  function setup() {
    const registry = new HealthTargetRegistry();
    registry.addTenant({ tenantId: 'tenant-a' });
    registry.addTenant({ tenantId: 'tenant-b' });
    registry.addSite({ tenantId: 'tenant-a', siteId: 'site-a1' });
    registry.addSite({ tenantId: 'tenant-a', siteId: 'site-a2' });
    registry.addSite({ tenantId: 'tenant-b', siteId: 'site-b1' });
    registry.addRouter({ tenantId: 'tenant-a', siteId: 'site-a1', routerId: 'router-a1', adapterType: 'mikrotik' });
    registry.addRouter({ tenantId: 'tenant-a', siteId: 'site-a2', routerId: 'router-a2', adapterType: 'mikrotik' });
    registry.addRouter({ tenantId: 'tenant-b', siteId: 'site-b1', routerId: 'router-b1', adapterType: 'mikrotik' });
    registry.grantSiteMembership({ principalId: 'roaming-user', tenantId: 'tenant-a', siteId: 'site-a1' });
    registry.grantSiteMembership({ principalId: 'roaming-user', tenantId: 'tenant-a', siteId: 'site-a2' });
    registry.grantSiteMembership({ principalId: 'roaming-user', tenantId: 'tenant-b', siteId: 'site-b1' });
    const adapterCalls = [];
    const checker = new HealthCheckOrchestrator({
      targetRegistry: registry,
      concurrency: 2,
      maxTargets: 2,
      adapters: new Map([['mikrotik', { checkHealth: async (scope) => { adapterCalls.push(scope); return { reachable: true }; } }]])
    });
    return { registry, checker, adapterCalls };
  }

  test('requires a roaming principal to choose a tenant or explicit scope', () => {
    const { checker } = setup();
    return expect(checker.check({ principalId: 'roaming-user', correlationId: 'c1', workId: 'w1', loopId: 'l1' }))
      .rejects.toThrow('roaming principal must select a tenant');
  });

  test('does not cross tenant boundaries when checking a selected tenant', async () => {
    const { checker, adapterCalls } = setup();
    const result = await checker.check({ tenantId: 'tenant-a', principalId: 'roaming-user', correlationId: 'c2', workId: 'w2', loopId: 'l2' });
    expect(result.targetCount).toBe(2);
    expect(result.evidence.every((item) => item.target.tenantId === 'tenant-a')).toBe(true);
    expect(adapterCalls.every((scope) => scope.tenantId === 'tenant-a')).toBe(true);
  });

  test('enforces a bounded target count for large fan-out requests', () => {
    const { checker, registry } = setup();
    registry.addRouter({ tenantId: 'tenant-a', siteId: 'site-a1', routerId: 'router-a3', adapterType: 'mikrotik' });
    return expect(checker.check({ tenantId: 'tenant-a', principalId: 'roaming-user', correlationId: 'c3', workId: 'w3', loopId: 'l3', siteIds: ['site-a1', 'site-a2'] }))
      .rejects.toThrow('target limit exceeded: 2');
  });

  test('serializes polling per tenant while allowing other tenants to progress', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let calls = 0;
    const checker = { check: async () => { calls += 1; await gate; return { targetCount: 1 }; } };
    const coordinator = new HealthPollingCoordinator({ checker });
    const first = coordinator.poll({ tenantId: 'tenant-a', principalId: 'p', correlationId: 'c4', workId: 'w4', loopId: 'l4' });
    const deferred = await coordinator.poll({ tenantId: 'tenant-a', principalId: 'p', correlationId: 'c5', workId: 'w5', loopId: 'l5' });
    const otherTenant = coordinator.poll({ tenantId: 'tenant-b', principalId: 'p', correlationId: 'c6', workId: 'w6', loopId: 'l6' });
    expect(deferred.status).toBe('deferred');
    expect(calls).toBe(2);
    release();
    await expect(first).resolves.toMatchObject({ status: 'completed' });
    await expect(otherTenant).resolves.toMatchObject({ status: 'completed' });
  });
});
