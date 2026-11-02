/**
 * Supabase persistence adapter for AgentOS agent identities.
 *
 * The client must be created server-side with a Supabase secret/service key.
 * No browser client, local-memory fallback, or client-provided tenant scope is
 * accepted here. The role is stored as metadata; agent_policies remains the
 * source of effective grants.
 */
const SELECT_COLUMNS = [
  'id', 'tenant_id', 'created_by_user_id', 'owner_user_id', 'parent_agent_id',
  'agent_key', 'display_name', 'agent_type', 'purpose', 'status', 'capabilities',
  'resource_scopes', 'policy_version', 'host_identity_id', 'budget_limit',
  'concurrency_limit', 'metadata', 'expires_at', 'created_at', 'updated_at', 'revoked_at',
].join(',');

function assertTenantId(tenantId) {
  if (typeof tenantId !== 'string' || !tenantId.trim()) throw new TypeError('AGENT_TENANT_REQUIRED');
  return tenantId.trim();
}

function mapIdentity(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    agentId: row.id,
    tenantId: row.tenant_id,
    createdBy: row.created_by_user_id,
    ownerUserId: row.owner_user_id,
    parentAgentId: row.parent_agent_id,
    agentKey: row.agent_key,
    name: row.display_name,
    label: row.display_name,
    role: row.metadata?.role || null,
    agentType: row.agent_type,
    purpose: row.purpose,
    status: row.status,
    capabilities: Array.isArray(row.capabilities) ? [...row.capabilities] : [],
    resourceScopes: Array.isArray(row.resource_scopes) ? [...row.resource_scopes] : [],
    policyVersion: row.policy_version,
    hostIdentityId: row.host_identity_id,
    budgetLimit: row.budget_limit,
    concurrencyLimit: row.concurrency_limit,
    metadata: row.metadata || {},
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at,
  });
}

function assertClient(client) {
  if (!client || typeof client.from !== 'function') {
    throw new TypeError('SUPABASE_AGENT_IDENTITY_CLIENT_REQUIRED');
  }
}

export function createSupabaseAgentIdentityStore({ client } = {}) {
  assertClient(client);

  return Object.freeze({
    async getForTenant(tenantId, agentId) {
      const tenant = assertTenantId(tenantId);
      if (typeof agentId !== 'string' || !agentId.trim()) throw new TypeError('AGENT_ID_REQUIRED');
      const { data, error } = await client.from('agent_identities')
        .select(SELECT_COLUMNS)
        .eq('tenant_id', tenant)
        .eq('id', agentId.trim())
        .maybeSingle();
      if (error) throw error;
      return mapIdentity(data);
    },

    async createForTenant(tenantId, definition = {}) {
      const tenant = assertTenantId(tenantId);
      if (definition.tenantId && definition.tenantId !== tenant) {
        throw new Error('AGENT_TENANT_SCOPE_VIOLATION');
      }
      if (!definition.createdBy || !definition.ownerUserId) {
        throw new Error('AGENT_OWNER_MEMBERSHIP_REQUIRED');
      }
      if (!definition.agentKey || !definition.name || !definition.role) {
        throw new TypeError('AGENT_IDENTITY_FIELDS_REQUIRED');
      }
      const payload = {
        tenant_id: tenant,
        created_by_user_id: definition.createdBy,
        owner_user_id: definition.ownerUserId,
        agent_key: definition.agentKey,
        display_name: definition.name,
        agent_type: definition.agentType || 'assistant',
        purpose: definition.purpose || definition.description || null,
        status: 'pending',
        capabilities: Array.isArray(definition.capabilities) ? definition.capabilities : [],
        resource_scopes: [],
        policy_version: 1,
        concurrency_limit: 1,
        metadata: {
          role: definition.role,
          domain: definition.domain || 'general',
          approvalRequired: Array.isArray(definition.approvalRequired) ? definition.approvalRequired : [],
          profileVersion: definition.profileVersion || '1.0.0',
        },
      };
      const { data, error } = await client.from('agent_identities')
        .insert(payload)
        .select(SELECT_COLUMNS)
        .single();
      if (error) throw error;
      return mapIdentity(data);
    },

    async removeForTenant(tenantId, agentId) {
      const tenant = assertTenantId(tenantId);
      if (typeof agentId !== 'string' || !agentId.trim()) throw new TypeError('AGENT_ID_REQUIRED');
      // Preserve identity and audit history. Decommission instead of DELETE.
      const { data, error } = await client.from('agent_identities')
        .update({ status: 'decommissioned', revoked_at: new Date().toISOString() })
        .eq('tenant_id', tenant)
        .eq('id', agentId.trim())
        .select(SELECT_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      return mapIdentity(data);
    },
  });
}

export default createSupabaseAgentIdentityStore;
