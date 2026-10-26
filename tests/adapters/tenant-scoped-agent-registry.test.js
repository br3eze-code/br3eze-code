import { describe, expect, test, jest } from '@jest/globals';
import { createTenantScopedAgentRegistry } from '../../src/adapters/agents/tenant-scoped-registry.js';

describe('tenant-scoped agent registry adapter', () => {
  test('scopes every operation to the server-derived tenant', async () => {
    const store = {
      getForTenant: jest.fn(async (tenantId, id) => ({ id, tenantId })),
      createForTenant: jest.fn(async (tenantId, definition) => ({ ...definition, tenantId })),
      removeForTenant: jest.fn(async (tenantId, id) => ({ id, tenantId })),
    };
    const registry = createTenantScopedAgentRegistry({ store });
    expect(await registry.get('agent-a', { tenantId: 'tenant-a' })).toEqual({ id: 'agent-a', tenantId: 'tenant-a' });
    expect(await registry.create({ id: 'agent-b' }, { tenantId: 'tenant-a' })).toEqual({ id: 'agent-b', tenantId: 'tenant-a' });
    expect(await registry.remove('agent-a', { tenantId: 'tenant-a' })).toEqual({ id: 'agent-a', tenantId: 'tenant-a' });
    expect(store.getForTenant).toHaveBeenCalledWith('tenant-a', 'agent-a');
    expect(store.createForTenant).toHaveBeenCalledWith('tenant-a', { id: 'agent-b', tenantId: 'tenant-a' });
    expect(store.removeForTenant).toHaveBeenCalledWith('tenant-a', 'agent-a');
  });

  test('fails closed when tenant context or tenant-scoped store is missing', async () => {
    expect(() => createTenantScopedAgentRegistry({ store: {} })).toThrow('AGENT_STORE_MUST_IMPLEMENT_GETFORTENANT');
    const registry = createTenantScopedAgentRegistry({ store: {
      getForTenant: async () => null,
      createForTenant: async (tenantId, definition) => ({ ...definition, tenantId }),
      removeForTenant: async () => null,
    } });
    await expect(registry.get('agent-a', {})).rejects.toThrow('AGENT_TENANT_REQUIRED');
    await expect(registry.create({ tenantId: 'tenant-b' }, { tenantId: 'tenant-a' })).rejects.toThrow('AGENT_TENANT_SCOPE_VIOLATION');
  });

  test('rejects cross-tenant records returned by a faulty backing store', async () => {
    const registry = createTenantScopedAgentRegistry({ store: {
      getForTenant: async () => ({ id: 'agent-a', tenantId: 'tenant-b' }),
      createForTenant: async () => null,
      removeForTenant: async () => null,
    } });
    await expect(registry.get('agent-a', { tenantId: 'tenant-a' })).rejects.toThrow('AGENT_TENANT_SCOPE_VIOLATION');
  });
});
