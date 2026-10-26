/**
 * Tenant-scoped AgentRegistry adapter.
 *
 * The backing store must implement getForTenant/createForTenant/removeForTenant.
 * It deliberately does not fall back to the process-global AgentRegistry:
 * absence of tenant-scoped storage is a configuration error, not permission
 * to read another tenant's agent definitions.
 */
function requireTenant(context = {}) {
  if (typeof context.tenantId !== 'string' || !context.tenantId.trim()) {
    throw new Error('AGENT_TENANT_REQUIRED');
  }
  return context.tenantId.trim();
}

function assertTenantRecord(agent, tenantId) {
  if (agent == null) return null;
  if (agent.tenantId !== tenantId) {
    const error = new Error('AGENT_TENANT_SCOPE_VIOLATION');
    error.code = 'AGENT_TENANT_SCOPE_VIOLATION';
    throw error;
  }
  return agent;
}

export function createTenantScopedAgentRegistry({ store } = {}) {
  for (const method of ['getForTenant', 'createForTenant', 'removeForTenant']) {
    if (typeof store?.[method] !== 'function') {
      throw new TypeError(`AGENT_STORE_MUST_IMPLEMENT_${method.toUpperCase()}`);
    }
  }

  return Object.freeze({
    async get(agentId, context = {}) {
      const tenantId = requireTenant(context);
      if (typeof agentId !== 'string' || !agentId.trim()) throw new TypeError('AGENT_ID_REQUIRED');
      return assertTenantRecord(await store.getForTenant(tenantId, agentId.trim()), tenantId);
    },

    async create(definition = {}, context = {}) {
      const tenantId = requireTenant(context);
      if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
        throw new TypeError('AGENT_DEFINITION_REQUIRED');
      }
      if (definition.tenantId && definition.tenantId !== tenantId) {
        throw new Error('AGENT_TENANT_SCOPE_VIOLATION');
      }
      const record = await store.createForTenant(tenantId, { ...definition, tenantId });
      return assertTenantRecord(record, tenantId);
    },

    async remove(agentId, context = {}) {
      const tenantId = requireTenant(context);
      if (typeof agentId !== 'string' || !agentId.trim()) throw new TypeError('AGENT_ID_REQUIRED');
      const existing = assertTenantRecord(await store.getForTenant(tenantId, agentId.trim()), tenantId);
      if (!existing) return null;
      const removed = await store.removeForTenant(tenantId, agentId.trim());
      return removed ? assertTenantRecord(removed === true ? existing : removed, tenantId) : null;
    },
  });
}

export default createTenantScopedAgentRegistry;
