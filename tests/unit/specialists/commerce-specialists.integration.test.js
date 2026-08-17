import { describe, expect, test } from '@jest/globals';
import { SpecialistRegistry } from '../../../src/runtime/specialist-registry.js';
import {
  CATALOG_SPECIALIST, PRICING_SPECIALIST, ORDERS_SPECIALIST, VOUCHER_SPECIALIST,
  FULFILLMENT_SPECIALIST, PROCUREMENT_SPECIALIST, BILLING_SPECIALIST, PROJECT_MANAGER_SPECIALIST,
  catalogSkill, pricingSkill, ordersSkill, voucherSkill, fulfillmentSkill, procurementSkill, billingSkill, projectManagerSkill,
} from '../../../src/runtime/commerce-specialists.js';
import { ToolRegistry, SpecialistRuntime } from '../../../src/core/specialists/index.js';

class ExecutionStore {
  constructor() { this.records = []; }
  append(record) { this.records.push(record); }
}

const specialists = [CATALOG_SPECIALIST, PRICING_SPECIALIST, ORDERS_SPECIALIST, VOUCHER_SPECIALIST, FULFILLMENT_SPECIALIST, PROCUREMENT_SPECIALIST, BILLING_SPECIALIST, PROJECT_MANAGER_SPECIALIST];
const skills = [catalogSkill, pricingSkill, ordersSkill, voucherSkill, fulfillmentSkill, procurementSkill, billingSkill, projectManagerSkill];

describe('commerce specialists SpecialistRuntime integration', () => {
  function setup() {
    const specialistRegistry = new SpecialistRegistry();
    for (const specialist of specialists) specialistRegistry.register(specialist);
    const toolRegistry = new ToolRegistry({ skills });
    const store = new ExecutionStore();
    const runtime = new SpecialistRuntime({ specialistRegistry, toolRegistry, executionStore: store });
    return { specialistRegistry, toolRegistry, runtime, store };
  }

  test('loads all remaining specialists with owned tools and explicit schemas', () => {
    const { specialistRegistry, toolRegistry } = setup();
    for (const specialist of specialists) {
      const loaded = specialistRegistry.get(specialist.id);
      expect(loaded).toMatchObject({ id: specialist.id, role: specialist.role, domain: 'commerce' });
      const tools = toolRegistry.toolsForSpecialist(loaded);
      expect(tools.length).toBeGreaterThan(0);
      for (const tool of tools) {
        expect(tool.specialist).toBe(specialist.role);
        expect(tool.parameters || tool.inputSchema).toBeDefined();
        expect(tool.outputSchema).toBeDefined();
        expect(tool.permissions.length).toBeGreaterThan(0);
        expect(tool.ticketTypes.length).toBeGreaterThan(0);
      }
    }
  });

  test('Catalog search executes through SpecialistRuntime with tenant-scoped provider context', async () => {
    const { runtime, store } = setup();
    const result = await runtime.execute('catalog-specialist', {
      task: { ticketType: 'product-inquiry' },
      skill: 'catalog',
      tool: 'catalog.search',
      args: { brand: 'Acme', limit: 10 },
      context: {
        tenantId: 'tenant-a', userId: 'user-1', permissions: ['catalog:read'],
        catalog: { async search({ scope, filters }) { return { tenantId: scope.tenantId, items: [{ tenantId: scope.tenantId, sku: filters.brand }] }; } },
      },
      correlationId: 'catalog-correlation-1',
    });
    expect(result.status).toBe('success');
    expect(result.output).toEqual({ tenantId: 'tenant-a', items: [{ tenantId: 'tenant-a', sku: 'Acme' }] });
    expect(result.execution).toMatchObject({ specialist: 'catalog-specialist', tool: 'catalog.search', correlationId: 'catalog-correlation-1', status: 'success' });
    expect(store.records).toHaveLength(1);
  });

  test('Catalog publication remains a proposal until approval matches tenant and action', async () => {
    const { runtime } = setup();
    const base = {
      skill: 'catalog', tool: 'catalog.publish',
      args: { productId: 'sku-1', version: '2', compatibilityPlan: 'backward-compatible', evidenceRefs: ['ev-1'] },
      context: { tenantId: 'tenant-a', userId: 'user-1', permissions: ['catalog:write'], catalog: { async publish({ scope }) { return { tenantId: scope.tenantId, published: true }; } } },
      ticketType: 'catalog-publication',
    };
    const proposal = await runtime.execute('catalog-specialist', base);
    expect(proposal.status).toBe('success');
    expect(proposal.output).toMatchObject({ status: 'approval_required', action: 'catalog.publish' });
    const approved = await runtime.execute('catalog-specialist', { ...base, context: { ...base.context, approval: { granted: true, action: 'catalog.publish', tenantId: 'tenant-a' } } });
    expect(approved.status).toBe('success');
    expect(approved.output).toMatchObject({ published: true, tenantId: 'tenant-a' });
  });
});
