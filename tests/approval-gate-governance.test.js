import { ApprovalGate } from '../src/core/approval-gate.js';

describe('ApprovalGate governance contract', () => {
  test('creates an expiring, scoped approval request', () => {
    let now = Date.parse('2026-08-17T10:00:00.000Z');
    const gate = new ApprovalGate({ clock: () => now, idFactory: () => 'apr-1', expiryMs: 60_000 });
    const result = gate.inspect({
      tool: 'network.mikrotik.configure',
      context: { tenantId: 'tenant-a', siteId: 'site-a', nodeId: 'router-a', actorId: 'operator-1', idempotencyKey: 'change-1' },
      metadata: { requiresApproval: true, action: 'router.configure', preview: { mode: 'safe' } }
    });
    expect(result.code).toBe('APPROVAL_REQUIRED');
    expect(result.request).toMatchObject({ tenantId: 'tenant-a', siteId: 'site-a', nodeId: 'router-a', action: 'router.configure', idempotencyKey: 'change-1' });
    expect(result.request.expiresAt).toBe('2026-08-17T10:01:00.000Z');

    now += 61_000;
    expect(gate.inspect({ tool: 'network.mikrotik.configure', context: { tenantId: 'tenant-a', siteId: 'site-a', nodeId: 'router-a', approval: { approvalId: 'apr-1' } }, metadata: { requiresApproval: true, action: 'router.configure' } })).toMatchObject({ code: 'APPROVAL_EXPIRED' });
  });

  test('reuses the same approval request for the same tenant-scoped idempotency key', () => {
    const gate = new ApprovalGate({ idFactory: (() => { let n = 0; return () => `apr-${++n}`; })() });
    const input = { tool: 'network.mikrotik.configure', context: { tenantId: 'tenant-a', siteId: 'site-a', idempotencyKey: 'same-change' }, metadata: { requiresApproval: true } };
    const first = gate.inspect(input);
    const second = gate.inspect(input);
    expect(second.request.approvalId).toBe(first.request.approvalId);
  });

  test('prevents approval reuse on another site or router', () => {
    const gate = new ApprovalGate({ idFactory: () => 'apr-1' });
    const pending = gate.inspect({ tool: 'network.mikrotik.configure', context: { tenantId: 'tenant-a', siteId: 'site-a', nodeId: 'router-a' }, metadata: { requiresApproval: true } });
    gate.approve(pending.request.approvalId, { approvedBy: 'manager-1', tenantId: 'tenant-a', siteId: 'site-a', nodeId: 'router-a' });
    expect(gate.inspect({ tool: 'network.mikrotik.configure', context: { tenantId: 'tenant-a', siteId: 'site-b', nodeId: 'router-a', approval: { approvalId: pending.request.approvalId, status: 'approved' } }, metadata: { requiresApproval: true } })).toMatchObject({ code: 'APPROVAL_SCOPE_MISMATCH' });
  });
});
