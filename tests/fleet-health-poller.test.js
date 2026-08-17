import { FleetHealthPoller } from '../src/core/fleet-health-poller.js';

function targetsFor(tenantId, count, prefix = tenantId) {
  return Array.from({ length: count }, (_, index) => ({
    tenantId,
    projectId: `${tenantId}-project`,
    meshGroupId: `${tenantId}-mesh`,
    siteId: `${tenantId}-site-${index % 5}`,
    nodeId: `${prefix}-node-${index}`,
    nodeType: 'router'
  }));
}

describe('FleetHealthPoller', () => {
  test('polls only the requested tenant with bounded concurrency and captures failures', async () => {
    const snapshots = [];
    let active = 0;
    let peak = 0;
    const notifications = [];
    const poller = new FleetHealthPoller({
      maxConcurrency: 7,
      timeoutMs: 100,
      listTargets: async () => [...targetsFor('tenant-a', 50), ...targetsFor('tenant-b', 50)],
      pollTarget: async (target) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        if (target.nodeId.endsWith('-13')) throw Object.assign(new Error('adapter unavailable'), { code: 'ADAPTER_OFFLINE' });
        return { status: 'online', metrics: { latencyMs: 12 } };
      },
      snapshotStore: { save: async (snapshot) => snapshots.push(snapshot) },
      notificationHub: { publish: (event) => notifications.push(event) },
      idFactory: () => 'poll-1'
    });

    const result = await poller.poll({ tenantId: 'tenant-a', principalId: 'principal-1' });
    expect(result.targetCount).toBe(50);
    expect(result.onlineCount).toBe(49);
    expect(result.offlineCount).toBe(1);
    expect(peak).toBeLessThanOrEqual(7);
    expect(snapshots).toHaveLength(50);
    expect(snapshots.every((snapshot) => snapshot.tenantId === 'tenant-a')).toBe(true);
    expect(notifications.every((event) => event.tenantId === 'tenant-a')).toBe(true);
  });

  test('filters by site and node scope and skips an active lease', async () => {
    const seen = [];
    const poller = new FleetHealthPoller({
      maxConcurrency: 2,
      listTargets: async () => targetsFor('tenant-a', 4),
      pollTarget: async (target) => { seen.push(target.nodeId); return { status: 'online' }; },
      idFactory: () => 'poll-2'
    });
    const first = await poller.poll({ tenantId: 'tenant-a', siteIds: ['tenant-a-site-1'], nodeIds: ['tenant-a-node-1'] });
    expect(first.targetCount).toBe(1);
    expect(seen).toEqual(['tenant-a-node-1']);

    poller.leases.set('tenant-a:tenant-a-node-1', { pollId: 'other-poll', expiresAt: Date.now() + 60_000 });
    const second = await poller.poll({ tenantId: 'tenant-a', nodeIds: ['tenant-a-node-1'] });
    expect(second.skippedCount).toBe(1);
    expect(second.results[0].reason).toBe('lease-held');
  });

  test('aggregates node results into a single site event instead of an alert per node', async () => {
    const notifications = [];
    const poller = new FleetHealthPoller({
      listTargets: async () => targetsFor('tenant-a', 3),
      pollTarget: async () => ({ status: 'offline' }),
      notificationHub: { publish: (event) => notifications.push(event) },
      idFactory: () => 'poll-3'
    });
    await poller.poll({ tenantId: 'tenant-a', siteIds: ['tenant-a-site-0'] });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe('fleet.site.health.aggregate');
    expect(notifications[0].counts.offline).toBe(1);
  });
});
