import { EventEmitter } from 'node:events';
import { InMemoryInventoryAdapter } from '../../src/core/inventory/inventory-adapter.js';
import { InventorySpecialistRuntime } from '../../src/core/inventory/inventory-runtime.js';

function approvedReserveContext(runtime, extra = {}) {
  const context = {
    tenantId: 'tenant-1',
    permissions: ['inventory:reserve'],
    ...extra,
  };
  const pending = runtime.approvalGate.inspect({
    tool: 'inventory.reserve',
    context,
    metadata: runtime.registry.getTool('inventory.reserve'),
  });
  const approval = runtime.approvalGate.approve(pending.request.approvalId, {
    approvedBy: 'manager-1',
    tenantId: 'tenant-1',
  });
  return { ...context, approval: { approvalId: approval.approvalId, status: 'approved' } };
}

describe('Inventory Specialist Phase 1 vertical', () => {
  let adapter;
  let eventBus;
  let runtime;

  beforeEach(() => {
    adapter = new InMemoryInventoryAdapter([
      { sku: 'SKU-001', name: 'Starter Plan', quantity: 25 },
    ]);
    eventBus = new EventEmitter();
    runtime = new InventorySpecialistRuntime({ adapter, eventBus });
  });

  test('golden path loads specialist, validates, reserves, records, and returns result', async () => {
    const events = [];
    eventBus.on('specialist.tool.executed', event => events.push(event));

    const result = await runtime.executeTask(
      {
        tool: 'inventory.reserve',
        input: {
          sku: 'SKU-001',
          quantity: 10,
          orderId: 'ORDER-42',
          idempotencyKey: 'ORDER-42:SKU-001:10',
        },
      },
      approvedReserveContext(runtime, {
        specialistId: 'inventory-specialist',
        skillId: 'inventory-specialist',
        taskId: 'TASK-42',
        actor: 'user-7',
        tenant: 'tenant-1',
        correlationId: 'corr-golden-42',
      })
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        sku: 'SKU-001',
        quantity: 10,
        orderId: 'ORDER-42',
        status: 'reserved',
      },
      execution: {
        executionId: expect.stringMatching(/^exe_/),
        specialist: 'inventory-specialist',
        specialistId: 'inventory-specialist',
        skillId: 'inventory-specialist',
        tool: 'inventory.reserve',
        toolId: 'inventory.reserve',
        taskId: 'TASK-42',
        actor: 'user-7',
        tenant: 'tenant-1',
        status: 'success',
        correlationId: 'corr-golden-42',
        inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        durationMs: expect.any(Number),
      },
    });
    expect(result.data.reservationId).toMatch(/^res_/);
    expect(result).toMatchObject({
      tool: 'inventory.reserve',
      executionId: expect.stringMatching(/^exe_/),
      evidence: [
        {
          type: 'inventory.audit',
          tool: 'inventory.reserve',
          status: 'success',
          riskLevel: 'medium',
        },
      ],
      warnings: [],
    });
    expect(result.execution.input).toEqual({
      sku: 'SKU-001',
      quantity: 10,
      orderId: 'ORDER-42',
      idempotencyKey: 'ORDER-42:SKU-001:10',
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toBe(result.execution);
    await expect(adapter.get('SKU-001')).resolves.toMatchObject({
      quantity: 25,
      reserved: 10,
      available: 15,
    });
  });

  test('exposes risk metadata and audit hooks through tool discovery', () => {
    const reserve = runtime.listTools().find(tool => tool.fullName === 'inventory.reserve');
    expect(reserve).toMatchObject({
      riskLevel: 'medium',
      permissions: ['inventory:reserve'],
    });
    expect(reserve.audit).toEqual(expect.any(Function));
    expect(runtime.registry.getManifest().tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'inventory.reserve',
          riskLevel: 'medium',
          auditable: true,
        }),
      ])
    );
  });

  test('returns a structured validation error for a negative quantity', async () => {
    const result = await runtime.executeTask(
      {
        tool: 'inventory.reserve',
        input: {
          sku: 'SKU-001',
          quantity: -1,
          orderId: 'ORDER-42',
          idempotencyKey: 'invalid-quantity',
        },
      },
      approvedReserveContext(runtime)
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_ERROR' },
      execution: {
        executionId: expect.stringMatching(/^exe_/),
        status: 'error',
        tool: 'inventory.reserve',
        inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        durationMs: expect.any(Number),
      },
    });
    await expect(adapter.get('SKU-001')).resolves.toMatchObject({ reserved: 0 });
  });

  test('returns a structured permission error before execution', async () => {
    const result = await runtime.executeTask(
      {
        tool: 'inventory.reserve',
        input: {
          sku: 'SKU-001',
          quantity: 1,
          orderId: 'ORDER-42',
          idempotencyKey: 'unauthorized',
        },
      },
      { permissions: ['inventory:read'] }
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: 'PERMISSION_DENIED' },
      execution: { status: 'error' },
    });
    await expect(adapter.get('SKU-001')).resolves.toMatchObject({ reserved: 0 });
  });

  test('returns structured business errors for unknown SKU and insufficient stock', async () => {
    const unknownSku = await runtime.executeTask(
      {
        tool: 'inventory.reserve',
        input: {
          sku: 'MISSING',
          quantity: 1,
          orderId: 'ORDER-42',
          idempotencyKey: 'unknown-sku',
        },
      },
      approvedReserveContext(runtime)
    );
    expect(unknownSku).toMatchObject({ success: false, error: { code: 'UNKNOWN_SKU' } });

    const insufficient = await runtime.executeTask(
      {
        tool: 'inventory.reserve',
        input: {
          sku: 'SKU-001',
          quantity: 26,
          orderId: 'ORDER-42',
          idempotencyKey: 'too-many',
        },
      },
      approvedReserveContext(runtime)
    );
    expect(insufficient).toMatchObject({ success: false, error: { code: 'INSUFFICIENT_STOCK' } });
  });

  test('replays an idempotent reservation without double-reserving stock', async () => {
    const input = {
      sku: 'SKU-001',
      quantity: 4,
      orderId: 'ORDER-42',
      idempotencyKey: 'repeatable',
    };
    const first = await runtime.executeTask(
      { tool: 'inventory.reserve', input },
      approvedReserveContext(runtime)
    );
    const second = await runtime.executeTask(
      { tool: 'inventory.reserve', input },
      approvedReserveContext(runtime)
    );

    expect(first.data.reservationId).toBe(second.data.reservationId);
    expect(second.data.idempotent).toBe(true);
    await expect(adapter.get('SKU-001')).resolves.toMatchObject({ reserved: 4, available: 21 });
  });
});
