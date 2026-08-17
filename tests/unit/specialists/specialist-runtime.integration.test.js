import { describe, expect, test } from '@jest/globals';
import { SpecialistRegistry } from '../../../src/runtime/specialist-registry.js';
import { INVENTORY_SPECIALIST, inventorySkill } from '../../../src/runtime/commerce-specialists.js';
import { ToolRegistry, SpecialistRuntime } from '../../../src/core/specialists/index.js';

class ExecutionStore {
  constructor() { this.records = []; }
  append(record) { this.records.push(record); }
}

describe('Phase 1 specialist runtime acceptance', () => {
  function setup() {
    const specialistRegistry = new SpecialistRegistry();
    specialistRegistry.register(INVENTORY_SPECIALIST);
    const toolRegistry = new ToolRegistry({ skills: [inventorySkill] });
    const store = new ExecutionStore();
    const runtime = new SpecialistRuntime({ specialistRegistry, toolRegistry, executionStore: store });
    return { specialistRegistry, toolRegistry, runtime, store };
  }

  test('loads specialist, discovers seven tools, executes search, and records immutable evidence', async () => {
    const { specialistRegistry, toolRegistry, runtime, store } = setup();
    const specialist = specialistRegistry.get('inventory-specialist');
    expect(specialist).toMatchObject({ id: 'inventory-specialist', domain: 'commerce' });
    expect(toolRegistry.toolsForSpecialist(specialist).map((tool) => tool.name)).toEqual([
      'inventory.search', 'inventory.get', 'inventory.reserve', 'inventory.release', 'inventory.adjust', 'inventory.transfer', 'inventory.lowStock',
    ]);

    const result = await runtime.execute('inventory-specialist', {
      task: { ticketType: 'inventory-inquiry' },
      skill: 'inventory',
      tool: 'inventory.search',
      args: { query: 'camera' },
      context: {
        tenantId: 'tenant-a',
        userId: 'user-1',
        permissions: ['inventory:read'],
        inventory: { async search({ scope }) { return [{ tenantId: scope.tenantId, itemId: 'item-1' }]; } },
      },
      correlationId: 'corr-1',
    });

    expect(result.status).toBe('success');
    expect(result.output).toEqual([{ tenantId: 'tenant-a', itemId: 'item-1' }]);
    expect(result.execution).toMatchObject({ specialist: 'inventory-specialist', tool: 'inventory.search', status: 'success', correlationId: 'corr-1' });
    expect(Object.isFrozen(result.execution)).toBe(true);
    expect(store.records).toHaveLength(1);
  });

  test('rejects missing permission before provider execution', async () => {
    const { runtime, store } = setup();
    let called = false;
    const result = await runtime.execute('inventory-specialist', {
      skill: 'inventory',
      tool: 'inventory.search',
      args: { query: 'camera' },
      context: {
        tenantId: 'tenant-a',
        userId: 'user-1',
        permissions: [],
        inventory: { async search() { called = true; return []; } },
      },
    });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('Permission denied');
    expect(called).toBe(false);
    expect(store.records[0].status).toBe('failed');
  });

  test('validates required input before executing a reservation', async () => {
    const { runtime } = setup();
    const result = await runtime.execute('inventory-specialist', {
      skill: 'inventory',
      tool: 'inventory.reserve',
      args: { itemId: 'item-1' },
      context: {
        tenantId: 'tenant-a',
        userId: 'user-1',
        permissions: ['inventory:write'],
        inventory: { async reserve() { throw new Error('provider should not run'); } },
      },
      ticketType: 'reserve-stock',
    });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('Input validation failed');
  });

  test('returns a proposal for a mutation until approval is bound to the tenant and action', async () => {
    const { runtime } = setup();
    const base = {
      skill: 'inventory',
      tool: 'inventory.reserve',
      args: { itemId: 'item-1', quantity: 1, idempotencyKey: 'idem-1' },
      context: {
        tenantId: 'tenant-a',
        userId: 'user-1',
        permissions: ['inventory:write'],
        inventory: { async reserve({ scope }) { return { tenantId: scope.tenantId, reservationId: 'res-1' }; } },
      },
      ticketType: 'reserve-stock',
    };
    const proposal = await runtime.execute('inventory-specialist', base);
    expect(proposal.status).toBe('success');
    expect(proposal.output).toMatchObject({ status: 'approval_required', action: 'inventory.reserve' });

    const approved = await runtime.execute('inventory-specialist', {
      ...base,
      context: { ...base.context, approval: { granted: true, action: 'inventory.reserve', tenantId: 'tenant-a' } },
    });
    expect(approved.status).toBe('success');
    expect(approved.output).toMatchObject({ reservationId: 'res-1' });
  });
});
