import { ResourceGovernance, RESOURCE_STATES } from '../src/core/resource-governance.js';

describe('ResourceGovernance', () => {
  test('reserves and transitions a tenant/site-scoped resource through its lifecycle', () => {
    const governance = new ResourceGovernance({ idFactory: () => 'resource-1', reservationFactory: () => 'reservation-1' });
    governance.register({ tenantId: 'tenant-a', siteId: 'site-a', resourceId: 'resource-1', type: 'router-capacity', quantity: 2 });
    const reservation = governance.reserve({ tenantId: 'tenant-a', siteId: 'site-a', resourceId: 'resource-1', quantity: 1, requestedBy: 'planner-1', idempotencyKey: 'reserve-1' });
    expect(reservation.state).toBe(RESOURCE_STATES.RESERVED);
    expect(governance.get({ tenantId: 'tenant-a', resourceId: 'resource-1' }).available).toBe(1);
    expect(governance.commit({ tenantId: 'tenant-a', reservationId: reservation.reservationId }).state).toBe(RESOURCE_STATES.COMMITTED);
    expect(governance.consume({ tenantId: 'tenant-a', reservationId: reservation.reservationId }).state).toBe(RESOURCE_STATES.CONSUMED);
  });

  test('replays the same reservation for a tenant-scoped idempotency key', () => {
    const governance = new ResourceGovernance({ reservationFactory: (() => { let n = 0; return () => `reservation-${++n}`; })() });
    governance.register({ tenantId: 'tenant-a', resourceId: 'resource-1', type: 'capacity', quantity: 1 });
    const first = governance.reserve({ tenantId: 'tenant-a', resourceId: 'resource-1', idempotencyKey: 'same' });
    const replay = governance.reserve({ tenantId: 'tenant-a', resourceId: 'resource-1', idempotencyKey: 'same' });
    expect(replay.reservationId).toBe(first.reservationId);
    expect(governance.get({ tenantId: 'tenant-a', resourceId: 'resource-1' }).available).toBe(0);
  });

  test('rejects cross-tenant access and site mismatch', () => {
    const governance = new ResourceGovernance();
    governance.register({ tenantId: 'tenant-a', siteId: 'site-a', resourceId: 'resource-1', type: 'router', quantity: 1 });
    expect(() => governance.get({ tenantId: 'tenant-b', resourceId: 'resource-1' })).toThrow('Resource not found');
    expect(() => governance.reserve({ tenantId: 'tenant-a', siteId: 'site-b', resourceId: 'resource-1', idempotencyKey: 'wrong-site' })).toThrow('Resource site mismatch');
  });

  test('releases capacity and returns the resource to available state', () => {
    const governance = new ResourceGovernance();
    governance.register({ tenantId: 'tenant-a', resourceId: 'resource-1', type: 'seat', quantity: 1 });
    const reservation = governance.reserve({ tenantId: 'tenant-a', resourceId: 'resource-1', idempotencyKey: 'release-me' });
    governance.release({ tenantId: 'tenant-a', reservationId: reservation.reservationId });
    expect(governance.get({ tenantId: 'tenant-a', resourceId: 'resource-1' })).toMatchObject({ available: 1, state: RESOURCE_STATES.AVAILABLE });
  });
});
