import { HandoffManager } from '../../src/core/handoff-manager.js';
import { ChannelAgentRouter } from '../../src/core/channel-agent-router.js';
import { ApprovalGate } from '../../src/core/approval-gate.js';
import { InMemoryInventoryAdapter } from '../../src/core/inventory/inventory-adapter.js';
import { InventorySpecialistRuntime } from '../../src/core/inventory/inventory-runtime.js';

function reservationInput() {
  return {
    sku: 'SKU-001',
    quantity: 2,
    orderId: 'ORDER-100',
    idempotencyKey: 'ORDER-100:SKU-001:2',
  };
}

describe('Inventory approval and channel-agent handoffs', () => {
  test('blocks protected reservation and returns a tenant-scoped approval request', async () => {
    const runtime = new InventorySpecialistRuntime({
      adapter: new InMemoryInventoryAdapter([{ sku: 'SKU-001', quantity: 5 }]),
      approvalGate: new ApprovalGate({ idFactory: () => 'apr_inventory_1' }),
    });

    const result = await runtime.execute('inventory.reserve', reservationInput(), {
      tenantId: 'tenant-1',
      projectId: 'project-1',
      taskId: 'ORDER-100',
      actor: 'orders-agent',
      permissions: ['inventory:reserve'],
    });

    expect(result).toMatchObject({
      success: false,
      error: {
        code: 'APPROVAL_REQUIRED',
        details: { approval: { approvalId: 'apr_inventory_1', tenantId: 'tenant-1', tool: 'inventory.reserve' } },
      },
    });
  });

  test('accepts an approved reservation only for the same tenant and tool', async () => {
    const gate = new ApprovalGate({ idFactory: () => 'apr_inventory_2' });
    const runtime = new InventorySpecialistRuntime({
      adapter: new InMemoryInventoryAdapter([{ sku: 'SKU-001', quantity: 5 }]),
      approvalGate: gate,
    });
    const context = { tenantId: 'tenant-1', permissions: ['inventory:reserve'], actor: 'orders-agent' };
    const pending = gate.inspect({ tool: 'inventory.reserve', context, metadata: runtime.registry.getTool('inventory.reserve') });
    gate.approve(pending.request.approvalId, { approvedBy: 'manager-1', tenantId: 'tenant-1' });

    const result = await runtime.execute('inventory.reserve', reservationInput(), {
      ...context,
      approval: { approvalId: 'apr_inventory_2', status: 'approved' },
    });

    expect(result.success).toBe(true);
    expect(result.execution.approvalId).toBe('apr_inventory_2');
    expect(result.execution.tenant).toBe('tenant-1');
  });

  test('preserves the work context through handoff lifecycle and channel delivery', async () => {
    const manager = new HandoffManager({ idFactory: () => 'handoff_1' });
    const handoff = manager.create({
      workId: 'COM-1042',
      loopId: 'loop_123',
      parentExecutionId: 'exe_orders_1',
      tenantId: 'tenant-1',
      projectId: 'project-1',
      from: 'orders',
      to: 'inventory',
      requestedAction: 'inventory.reserve',
      acceptanceCriteria: ['reservation.status === reserved', 'reservation.quantity === 2'],
      evidence: [{ type: 'order.created', orderId: 'ORDER-100' }],
      openRisks: ['stock may be insufficient'],
      deadline: '2026-08-17T12:00:00.000Z',
    });

    expect(manager.acknowledge('handoff_1', 'inventory-agent').status).toBe('acknowledged');
    expect(manager.accept('handoff_1', 'inventory-agent').status).toBe('accepted');

    const sent = [];
    const router = new ChannelAgentRouter({
      channelManager: { send: async (...args) => sent.push(args) },
    });
    await expect(router.dispatch(manager.get('handoff_1'), {
      userId: 'user-1',
      channel: 'telegram',
      tenantId: 'tenant-1',
    })).resolves.toMatchObject({ delivered: true, handoffId: 'handoff_1' });
    expect(sent[0][2].metadata).toMatchObject({
      handoffId: 'handoff_1',
      workId: 'COM-1042',
      loopId: 'loop_123',
      parentExecutionId: 'exe_orders_1',
      from: 'orders',
      to: 'inventory',
    });

    expect(router.dispatch(manager.get('handoff_1'), {
      userId: 'user-1', channel: 'telegram', tenantId: 'tenant-2',
    })).resolves.toMatchObject({ delivered: false, code: 'TENANT_SCOPE_MISMATCH' });
    expect(manager.reject('handoff_1', 'inventory-agent', 'scope unavailable').status).toBe('rejected');
    expect(manager.returnToSource('handoff_1', 'orders-agent').status).toBe('returned');
    expect(manager.complete('handoff_1', 'orders-agent', [{ type: 'inventory.reserved' }]).status).toBe('completed');
  });
});
