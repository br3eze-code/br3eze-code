import { describe, expect, test } from '@jest/globals';
import { ToolRegistry } from '../../../src/core/ToolRegistry.js';
import { registerCommerceSpecialists } from '../../../src/runtime/commerce-specialists.js';
import { inventorySkill, catalogSkill, procurementSkill } from '../../../src/runtime/commerce-specialists.js';

describe('Inventory and Catalog specialist runtime contracts', () => {
  test('registers both specialists with role-bound ticket capabilities', () => {
    const registry = registerCommerceSpecialists();
    expect(registry.canHandle('inventory', 'reserve-stock')).toBe(true);
    expect(registry.canHandle('catalog', 'catalog-publication')).toBe(true);
    expect(registry.canHandle('inventory', 'catalog-publication')).toBe(false);
    expect(registry.get('inventory').skillNames).toEqual(['inventory']);
    expect(registry.get('catalog').skillNames).toEqual(['catalog']);
  });

  test('inventory search preserves tenant and site scope', async () => {
    const registry = new ToolRegistry({ requireExecutionTask: false });
    registry.registerSkill(inventorySkill);
    const calls = [];
    const context = {
      agentRole: 'inventory',
      permissions: ['inventory:read'],
      tenantId: 'tenant-a',
      userId: 'user-1',
      siteId: 'site-1',
      inventory: {
        async search(input) {
          calls.push(input);
          return [{ tenantId: 'tenant-a', siteId: 'site-1', itemId: 'item-1', available: 4 }];
        },
      },
    };
    const result = await registry.execute('inventory.search', { query: 'camera' }, context);
    expect(result).toBeDefined();
    expect(calls[0].scope).toEqual({ tenantId: 'tenant-a', userId: 'user-1', siteId: 'site-1' });
  });

  test('inventory rejects a cross-tenant provider result', async () => {
    const registry = new ToolRegistry({ requireExecutionTask: false });
    registry.registerSkill(inventorySkill);
    await expect(registry.execute('inventory.get', { itemId: 'item-1' }, {
      agentRole: 'inventory',
      permissions: ['inventory:read'],
      tenantId: 'tenant-a',
      userId: 'user-1',
      inventory: { async get() { return { tenantId: 'tenant-b', itemId: 'item-1' }; } },
    })).rejects.toThrow('Inventory result is outside the authorized tenant scope');
  });

  test('inventory mutations return proposals until matching approval is present', async () => {
    const registry = new ToolRegistry({ requireExecutionTask: false });
    registry.registerSkill(inventorySkill);
    const context = {
      agentRole: 'inventory',
      permissions: ['inventory:write'],
      tenantId: 'tenant-a',
      userId: 'user-1',
      inventory: { async reserve() { return { tenantId: 'tenant-a', reservationId: 'r-1' }; } },
    };
    const proposal = await registry.execute('inventory.reserve', { itemId: 'item-1', quantity: 1, idempotencyKey: 'idem-1' }, context);
    expect(proposal).toMatchObject({ status: 'approval_required', action: 'inventory.reserve' });
    const approved = await registry.execute('inventory.reserve', { itemId: 'item-1', quantity: 1, idempotencyKey: 'idem-1' }, { ...context, approval: { granted: true, action: 'inventory.reserve', tenantId: 'tenant-a' } });
    expect(approved).toMatchObject({ reservationId: 'r-1' });
  });

  test('catalog search delegates to the provider-neutral product query service', async () => {
    const registry = new ToolRegistry({ requireExecutionTask: false });
    registry.registerSkill(catalogSkill);
    const calls = [];
    const result = await registry.execute('catalog.search', { name: 'Camera', include: ['description', 'availability'] }, {
      agentRole: 'catalog',
      permissions: ['catalog:read'],
      tenantId: 'tenant-a',
      userId: 'user-1',
      productQueryService: {
        async search(input) {
          calls.push(input);
          return { tenantId: 'tenant-a', items: [{ tenantId: 'tenant-a', id: 'p-1', name: 'Camera', supplierId: 'supplier-a', supplierReferenceUrl: 'https://supplier.example/camera' }] };
        },
      },
    });
    expect(result).toMatchObject({ tenantId: 'tenant-a' });
    expect(calls[0].scope).toMatchObject({ tenantId: 'tenant-a', userId: 'user-1' });
    expect(calls[0].filters).toEqual({ name: 'Camera', include: ['description', 'availability'] });
    expect(calls[0].include).toEqual(expect.arrayContaining(['supplierReferenceUrl', 'supplierId', 'supplierSku', 'supplierFulfillmentMode']));
    expect(result.items[0]).toMatchObject({ supplierId: 'supplier-a', supplierReferenceUrl: 'https://supplier.example/camera' });
  });



  test('catalog removes unsafe supplier URLs before returning product results', async () => {
    const registry = new ToolRegistry({ requireExecutionTask: false });
    registry.registerSkill(catalogSkill);
    const result = await registry.execute('catalog.search', { name: 'Unsafe item' }, {
      agentRole: 'catalog', permissions: ['catalog:read'], tenantId: 'tenant-a', userId: 'user-1',
      catalog: {
        async search({ scope }) {
          return { tenantId: scope.tenantId, items: [
            { tenantId: scope.tenantId, id: 'p-safe', supplierReferenceUrl: 'https://supplier.example/p-safe' },
            { tenantId: scope.tenantId, id: 'p-unsafe', supplierReferenceUrl: 'javascript:alert(1)' },
          ] };
        },
      },
    });
    expect(result.items[0].supplierReferenceUrl).toBe('https://supplier.example/p-safe');
    expect(result.items[1].supplierReferenceUrl).toBeNull();
  });

  test('procurement exposes supplier references and approval-gates API provisioning', async () => {
    const registry = new ToolRegistry({ requireExecutionTask: false });
    registry.registerSkill(procurementSkill);
    const provisioningCalls = [];
    const supplierCatalog = {
      async getSupplierReference({ productId, scope }) {
        return { tenantId: scope.tenantId, productId, supplierReferenceUrl: 'https://supplier.example/catalog/p-1' };
      },
    };
    const supplierProvisioning = {
      async provisionProduct(input) {
        provisioningCalls.push(input);
        return { tenantId: input.scope.tenantId, orderId: 'po-1', status: 'ordered' };
      },
    };
    const context = {
      agentRole: 'procurement', permissions: ['procurement:read', 'procurement:write'],
      tenantId: 'tenant-a', userId: 'user-1', projectId: 'project-a',
      supplierCatalog, supplierProvisioning,
    };
    const reference = await registry.execute('procurement.product-reference', { productId: 'p-1' }, context);
    expect(reference).toMatchObject({ supplierReferenceUrl: 'https://supplier.example/catalog/p-1' });
    const proposal = await registry.execute('procurement.provision-product', {
      productId: 'p-1', quantity: 3, idempotencyKey: 'po-request-1',
    }, context);
    expect(proposal).toMatchObject({ status: 'approval_required', externalSupplierCalled: false });
    expect(provisioningCalls).toHaveLength(0);
    const result = await registry.execute('procurement.provision-product', {
      productId: 'p-1', quantity: 3, idempotencyKey: 'po-request-1',
    }, { ...context, approval: { status: 'APPROVED', approvalId: 'appr-1', action: 'purchase.order', tenantId: 'tenant-a', projectId: 'project-a' } });
    expect(result).toMatchObject({ tenantId: 'tenant-a', orderId: 'po-1', status: 'ordered' });
    expect(provisioningCalls).toHaveLength(1);
  });

  test('catalog publication is approval-gated and does not mutate pricing or inventory', async () => {
    const registry = new ToolRegistry({ requireExecutionTask: false });
    registry.registerSkill(catalogSkill);
    const calls = [];
    const context = {
      agentRole: 'catalog',
      permissions: ['catalog:write'],
      tenantId: 'tenant-a',
      userId: 'user-1',
      catalog: { async publish(input) { calls.push(input); return { tenantId: 'tenant-a', status: 'published' }; } },
    };
    const proposal = await registry.execute('catalog.publish', { productId: 'p-1', version: 'v2', compatibilityPlan: 'backward-compatible' }, context);
    expect(proposal).toMatchObject({ status: 'approval_required', action: 'catalog.publish' });
    expect(calls).toHaveLength(0);
    const approved = await registry.execute('catalog.publish', { productId: 'p-1', version: 'v2', compatibilityPlan: 'backward-compatible' }, { ...context, approval: { granted: true, action: 'catalog.publish', tenantId: 'tenant-a' } });
    expect(approved).toMatchObject({ status: 'published' });
    expect(calls[0].scope.tenantId).toBe('tenant-a');
  });
});
