import { describe, expect, test } from '@jest/globals';
import { SpecialistRegistry } from '../../../src/runtime/specialist-registry.js';
import { INVENTORY_SPECIALIST, CATALOG_SPECIALIST, inventorySkill } from '../../../src/runtime/commerce-specialists.js';
import { ToolRegistry, SpecialistRuntime, createHandoff } from '../../../src/core/specialists/index.js';

class ExecutionStore {
  constructor() { this.records = []; }
  append(record) { this.records.push(record); }
}

describe('Phase 2 Inventory specialist vertical', () => {
  function setup(provider) {
    const specialistRegistry = new SpecialistRegistry();
    specialistRegistry.register(INVENTORY_SPECIALIST);
    specialistRegistry.register(CATALOG_SPECIALIST);
    const toolRegistry = new ToolRegistry({ skills: [inventorySkill] });
    const store = new ExecutionStore();
    const runtime = new SpecialistRuntime({ specialistRegistry, toolRegistry, executionStore: store, idFactory: (() => { let i = 0; return () => `exec_${++i}`; })() });
    return { runtime, store, provider };
  }

  const contextFor = (provider, extra = {}) => ({
    tenantId: 'tenant-a',
    userId: 'user-1',
    permissions: ['inventory:read', 'inventory:write'],
    inventory: provider,
    ...extra,
  });

  test('returns the universal structured result with execution metadata and evidence', async () => {
    const { runtime, store } = setup({
      async search({ scope }) { return [{ tenantId: scope.tenantId, itemId: 'item-1', evidenceRefs: ['snapshot-1'] }]; },
    });
    const result = await runtime.execute('inventory-specialist', {
      task: { ticketType: 'inventory-inquiry', taskId: 'TASK-1' },
      skill: 'inventory',
      tool: 'inventory.search',
      args: { query: 'camera', evidenceRefs: ['count-sheet-1'] },
      context: contextFor({ async search({ scope }) { return [{ tenantId: scope.tenantId, itemId: 'item-1', evidenceRefs: ['snapshot-1'] }]; } }),
      correlationId: 'corr-phase2-1',
    });

    expect(result.success).toBe(true);
    expect(result.tool).toBe('inventory.search');
    expect(result.executionId).toBe('exec_1');
    expect(result.data).toEqual([{ tenantId: 'tenant-a', itemId: 'item-1', evidenceRefs: ['snapshot-1'] }]);
    expect(result.evidence).toEqual(['count-sheet-1']);
    expect(result.execution).toMatchObject({ ticketId: 'TASK-1', actor: 'user-1', tenant: 'tenant-a', inputHash: expect.any(String), durationMs: expect.any(Number) });
    expect(store.records[0].result).toMatchObject({ success: true, tool: 'inventory.search', executionId: 'exec_1' });
  });

  test('enforces input and output failures before accepting execution', async () => {
    const { runtime, store } = setup({ async get() { return { tenantId: 'tenant-a', itemId: 42 }; } });
    const missingInput = await runtime.execute('inventory-specialist', {
      skill: 'inventory', tool: 'inventory.get', args: {},
      context: contextFor({ async get() { throw new Error('provider must not run'); } }),
    });
    expect(missingInput.success).toBe(false);
    expect(missingInput.error).toContain('Input validation failed');

    const wrongOutput = await runtime.execute('inventory-specialist', {
      skill: 'inventory', tool: 'inventory.get', args: { itemId: 'item-1' },
      context: contextFor({ async get() { return { tenantId: 'tenant-b', itemId: 'item-1' }; } }),
    });
    expect(wrongOutput.success).toBe(false);
    expect(wrongOutput.error).toContain('outside the authorized tenant scope');
    expect(store.records).toHaveLength(2);
    expect(store.records.every((record) => record.result.success === false)).toBe(true);
  });

  test('supports idempotent approved reservations and replays the original execution', async () => {
    let calls = 0;
    const provider = { async reserve({ scope }) { calls += 1; return { tenantId: scope.tenantId, reservationId: 'RES-1', evidence: ['reservation-ledger-1'] }; } };
    const { runtime } = setup(provider);
    const request = {
      skill: 'inventory', tool: 'inventory.reserve', ticketType: 'reserve-stock',
      args: { itemId: 'item-1', quantity: 2, idempotencyKey: 'reserve-1', evidenceRefs: ['stock-count-1'] },
      context: contextFor(provider, { approval: { granted: true, action: 'inventory.reserve', tenantId: 'tenant-a' } }),
    };
    const first = await runtime.execute('inventory-specialist', request);
    const replay = await runtime.execute('inventory-specialist', request);
    expect(first.success).toBe(true);
    expect(replay.status).toBe('replayed');
    expect(replay.execution.replayOf).toBe(first.executionId);
    expect(calls).toBe(1);
    expect(first.evidence).toEqual(['stock-count-1', 'reservation-ledger-1']);
  });

  test('runs approved inventory reconciliation and preserves evidence', async () => {
    const provider = { async reconcile({ scope, evidenceRefs }) { return { tenantId: scope.tenantId, itemId: 'item-1', corrected: true, evidenceRefs }; } };
    const { runtime } = setup(provider);
    const result = await runtime.execute('inventory-specialist', {
      skill: 'inventory', tool: 'inventory.reconcile', ticketType: 'reconcile-stock',
      args: { itemId: 'item-1', countedQuantity: 8, evidenceRefs: ['count-sheet-8'], idempotencyKey: 'reconcile-1' },
      context: contextFor(provider, { approval: { granted: true, action: 'inventory.reconcile', tenantId: 'tenant-a' } }),
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ corrected: true });
    expect(result.evidence).toEqual(['count-sheet-8']);
  });

  test('does not replay an idempotent mutation across users in the same tenant', async () => {
    let calls = 0;
    const provider = { async reserve({ scope }) { calls += 1; return { tenantId: scope.tenantId, reservationId: `RES-${calls}` }; } };
    const { runtime } = setup(provider);
    const request = {
      skill: 'inventory', tool: 'inventory.reserve', ticketType: 'reserve-stock',
      args: { itemId: 'item-1', quantity: 1, idempotencyKey: 'same-key' },
      context: contextFor(provider, { approval: { granted: true, action: 'inventory.reserve', tenantId: 'tenant-a' } }),
    };
    const first = await runtime.execute('inventory-specialist', request);
    const otherUser = await runtime.execute('inventory-specialist', { ...request, context: { ...request.context, userId: 'user-2' } });
    expect(first.success).toBe(true);
    expect(otherUser.success).toBe(true);
    expect(otherUser.status).not.toBe('replayed');
    expect(calls).toBe(2);
  });

  test('creates a tenant-scoped runtime handoff only for an allowed specialist target', () => {
    const { runtime } = setup({});
    const handoff = runtime.createHandoff('inventory-specialist', {
      to: 'catalog', workPackageId: 'WP-205', requestedAction: 'verify product identity',
      context: { tenantId: 'tenant-a', userId: 'user-1' }, evidence: ['sku-sheet-1'], acceptanceCriteria: ['catalog version verified'],
    });
    expect(handoff).toMatchObject({ from: 'inventory', to: 'catalog', tenantId: 'tenant-a', workPackageId: 'WP-205' });
    expect(() => runtime.createHandoff('inventory-specialist', {
      to: 'billing', workPackageId: 'WP-206', requestedAction: 'capture payment', context: { tenantId: 'tenant-a', userId: 'user-1' },
    })).toThrow('Target specialist not found');
  });

  test('uses a canonical hash for nested arguments with different key order', async () => {
    const provider = { async search() { return [{ tenantId: 'tenant-a', itemId: 'item-1' }]; } };
    const { runtime } = setup(provider);
    const base = { skill: 'inventory', tool: 'inventory.search', args: { query: 'camera', filters: { site: 's1', status: 'available' }, idempotencyKey: 'nested-key' }, context: contextFor(provider) };
    const first = await runtime.execute('inventory-specialist', base);
    const replay = await runtime.execute('inventory-specialist', { ...base, args: { query: 'camera', filters: { status: 'available', site: 's1' }, idempotencyKey: 'nested-key' } });
    expect(replay.status).toBe('replayed');
    expect(replay.execution.replayOf).toBe(first.executionId);
  });

  test('creates a tenant-scoped handoff with evidence and acceptance criteria', () => {
    const handoff = createHandoff({
      from: 'orders', to: 'inventory', workPackageId: 'WP-204', requestedAction: 'reserve stock',
      tenantId: 'tenant-a', userId: 'user-1', evidence: ['order-1'], acceptanceCriteria: ['reservationId returned'],
    });
    expect(handoff).toMatchObject({ from: 'orders', to: 'inventory', workPackageId: 'WP-204', tenantId: 'tenant-a', status: 'requested' });
    expect(Object.isFrozen(handoff)).toBe(true);
    expect(handoff.evidence).toEqual(['order-1']);
  });
});

