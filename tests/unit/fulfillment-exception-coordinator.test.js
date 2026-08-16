import { jest } from '@jest/globals';
import { FulfillmentExceptionCoordinator } from '../../src/core/fulfillment-exception-coordinator.js';

function context(overrides = {}) {
  return { tenantId: 'tenant-1', projectId: 'project-1', userId: 'user-1', siteId: 'site-1', ...overrides };
}

test('detects a vendor delay and hands it to Procurement with evidence', async () => {
  const events = [];
  const projectManager = {
    proposeHandoff: jest.fn(async (input) => ({ handoffId: 'handoff-1', ...input })),
  };
  const bus = { emit: (name, payload) => events.push({ name, payload }) };
  const coordinator = new FulfillmentExceptionCoordinator({ projectManager, bus, now: () => '2026-08-16T00:00:00.000Z' });
  const exception = coordinator.detectDelay({
    context: context(),
    order: { orderId: 'order-1', supplierId: 'supplier-1', currency: 'USD' },
    milestone: { dueAt: '2026-08-10T00:00:00.000Z' },
    providerEvent: { provider: 'dhl', trackingId: 'track-1', status: 'delayed', occurredAt: '2026-08-16T00:00:00.000Z', evidenceRef: 'event-1' },
  });
  expect(exception.state).toBe('detected');
  expect(exception.activity.activityNumber).toBe('ACT-EXPEDITOR-WP-EXP-003');
  expect(exception.evidenceRefs).toEqual(['event-1']);

  const handoff = await coordinator.requestProcurementResponse({ context: context(), exception });
  expect(projectManager.proposeHandoff).toHaveBeenCalledWith(expect.objectContaining({ fromRole: 'expeditor', toRole: 'procurement', wbsId: 'WP-PRO-003' }));
  expect(handoff.exception.state).toBe('supplier_response_pending');
  expect(events.map((event) => event.name)).toEqual(['fulfillment.exception.detected', 'fulfillment.exception.procurement_requested']);
});

test('proposes recovery options and blocks approval without explicit authorization', () => {
  const coordinator = new FulfillmentExceptionCoordinator({
    projectManager: { proposeHandoff: jest.fn() },
    bus: { emit: jest.fn() },
    now: () => '2026-08-16T00:00:00.000Z',
  });
  const exception = { ...coordinator.detectDelay({ context: context(), order: { orderId: 'order-2' }, milestone: { delayed: true } }), state: 'supplier_response_pending' };
  const proposal = coordinator.proposeRecovery({ context: context(), exception, options: [
    { type: 'alternate_supplier', costImpact: 500, timeImpactDays: -3, recommended: true },
    { type: 'accept_delay', costImpact: 0, timeImpactDays: 5 },
  ] });
  expect(proposal.state).toBe('recovery_proposed');
  expect(coordinator.approveRecovery({ context: context(), proposal })).toMatchObject({ status: 'approval_required', action: 'supplier.commit_or_scope_change' });
  expect(coordinator.approveRecovery({ context: context({ approvalGranted: true }), proposal, optionType: 'alternate_supplier' })).toMatchObject({ state: 'approved', approvedOption: 'alternate_supplier' });
});

test('rejects cross-tenant exceptions', () => {
  const coordinator = new FulfillmentExceptionCoordinator({ projectManager: { proposeHandoff: jest.fn() }, bus: { emit: jest.fn() } });
  expect(() => coordinator.detectDelay({ context: context(), order: { orderId: 'other-order', tenantId: 'tenant-2' }, milestone: { delayed: true } })).toThrow('Cross-tenant');
});

test('requires complete execution scope for every operation', () => {
  const coordinator = new FulfillmentExceptionCoordinator({ projectManager: { proposeHandoff: jest.fn() }, bus: { emit: jest.fn() } });
  expect(() => coordinator.detectDelay({ context: { tenantId: 'tenant-1', projectId: 'project-1' }, order: { orderId: 'order-1' }, milestone: { delayed: true } })).toThrow('userId is required');
  expect(() => coordinator.detectDelay({ context: { tenantId: 'tenant-1', userId: 'user-1' }, order: { orderId: 'order-1' }, milestone: { delayed: true } })).toThrow('projectId is required');
});

test('rejects cross-tenant Procurement handoff and recovery approval', async () => {
  const projectManager = { proposeHandoff: jest.fn() };
  const coordinator = new FulfillmentExceptionCoordinator({ projectManager, bus: { emit: jest.fn() } });
  const exception = coordinator.detectDelay({ context: context(), order: { orderId: 'order-3' }, milestone: { delayed: true } });
  await expect(coordinator.requestProcurementResponse({ context: context({ tenantId: 'tenant-2' }), exception })).rejects.toMatchObject({ code: 'TENANT_SCOPE_VIOLATION', status: 403 });
  const proposal = coordinator.proposeRecovery({ context: context(), exception: { ...exception, state: 'supplier_response_pending' }, options: [{ type: 're_tender', recommended: true }] });
  expect(() => coordinator.approveRecovery({ context: context({ tenantId: 'tenant-2', approvalGranted: true }), proposal })).toThrow('Cross-tenant');
});

test('does not allow approval flag to be supplied by an unrelated tenant or option payload', () => {
  const coordinator = new FulfillmentExceptionCoordinator({ projectManager: { proposeHandoff: jest.fn() }, bus: { emit: jest.fn() } });
  const exception = { ...coordinator.detectDelay({ context: context(), order: { orderId: 'order-4' }, milestone: { delayed: true } }), state: 'supplier_response_pending' };
  const proposal = coordinator.proposeRecovery({ context: context(), exception, options: [{ type: 'buy_make_review', approved: true }] });
  expect(proposal.options[0].requiresApproval).toBe(true);
  expect(coordinator.approveRecovery({ context: context(), proposal })).toMatchObject({ status: 'approval_required' });
});

test('blocks invalid recovery and closure transitions', () => {
  const coordinator = new FulfillmentExceptionCoordinator({ projectManager: { proposeHandoff: jest.fn() }, bus: { emit: jest.fn() } });
  const detected = coordinator.detectDelay({ context: context(), order: { orderId: 'order-5' }, milestone: { delayed: true } });
  expect(() => coordinator.close({ context: context(), exception: detected })).toThrow('Cannot close exception');
  expect(() => coordinator.proposeRecovery({ context: context(), exception: { ...detected, state: 'closed' }, options: [{ type: 'accept_delay' }] })).toThrow('Cannot propose recovery');
});

test('closure merges evidence without duplicates and preserves tenant scope', () => {
  const coordinator = new FulfillmentExceptionCoordinator({ projectManager: { proposeHandoff: jest.fn() }, bus: { emit: jest.fn() }, now: () => '2026-08-16T00:00:00.000Z' });
  const exception = { ...coordinator.detectDelay({ context: context(), order: { orderId: 'order-6' }, milestone: { delayed: true }, providerEvent: { evidenceRefs: ['provider-1'] } }), state: 'resolved' };
  const closed = coordinator.close({ context: context(), exception, evidenceRefs: ['provider-1', 'receipt-1'], resolution: 'delivered_and_verified' });
  expect(closed.state).toBe('closed');
  expect(closed.evidenceRefs).toEqual(['provider-1', 'receipt-1']);
  expect(closed.tenantId).toBe('tenant-1');
});
