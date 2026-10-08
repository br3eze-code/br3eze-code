import { describe, expect, test } from '@jest/globals';
import { ToolRegistry } from '../../../src/core/ToolRegistry.js';
import { registerCommerceSpecialists } from '../../../src/runtime/commerce-specialists.js';
import { inventorySkill, catalogSkill } from '../../../src/runtime/commerce-specialists.js';

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
    const registry = new ToolRegistry();
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
    const registry = new ToolRegistry();
    registry.registerSkill(inventorySkill);
    const result = await registry.execute('inventory.get', { itemId: 'item-1' }, {
      agentRole: 'inventory',
      permissions: ['inventory:read'],
      tenantId: 'tenant-a',
      userId: 'user-1',
      inventory: { async get() { return { tenantId: 'tenant-b', itemId: 'item-1' }; } },
    });
    expect(result).toBeUndefined();
  });

  test('inventory mutations return proposals until matching approval is present', async () => {
    const registry = new ToolRegistry();
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
    const registry = new ToolRegistry();
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
          return { tenantId: 'tenant-a', items: [{ tenantId: 'tenant-a', id: 'p-1', name: 'Camera' }] };
        },
      },
    });
    expect(result).toMatchObject({ tenantId: 'tenant-a' });
    expect(calls[0].scope).toMatchObject({ tenantId: 'tenant-a', userId: 'user-1' });
    expect(calls[0].filters).toEqual({ name: 'Camera', include: ['description', 'availability'] });
  });

  test('catalog publication is approval-gated and does not mutate pricing or inventory', async () => {
    const registry = new ToolRegistry();
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
