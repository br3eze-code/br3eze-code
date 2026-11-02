import { describe, expect, test, jest } from '@jest/globals';
import { createSupabaseAgentIdentityStore } from '../../src/adapters/agents/supabase-agent-identity-store.js';

function makeClient(result) {
  const query = {
    select: jest.fn(() => query),
    eq: jest.fn(() => query),
    insert: jest.fn(() => query),
    update: jest.fn(() => query),
    maybeSingle: jest.fn(async () => result),
    single: jest.fn(async () => result),
  };
  return { client: { from: jest.fn(() => query) }, query };
}

const row = {
  id: '00000000-0000-4000-8000-000000000001',
  tenant_id: 'tenant-a',
  created_by_user_id: 'user-a',
  owner_user_id: 'user-a',
  agent_key: 'engineer:field-engineer',
  display_name: 'Field Engineer',
  agent_type: 'assistant',
  purpose: 'Inspect network systems',
  status: 'pending',
  capabilities: ['diagnostics.read'],
  resource_scopes: [],
  policy_version: 1,
  concurrency_limit: 1,
  metadata: { role: 'engineer', domain: 'network' },
};

describe('Supabase agent identity store', () => {
  test('reads an identity using both tenant and immutable agent ID', async () => {
    const { client, query } = makeClient({ data: row, error: null });
    const store = createSupabaseAgentIdentityStore({ client });
    const result = await store.getForTenant('tenant-a', row.id);
    expect(client.from).toHaveBeenCalledWith('agent_identities');
    expect(query.eq).toHaveBeenNthCalledWith(1, 'tenant_id', 'tenant-a');
    expect(query.eq).toHaveBeenNthCalledWith(2, 'id', row.id);
    expect(result).toMatchObject({ id: row.id, tenantId: 'tenant-a', role: 'engineer', name: 'Field Engineer' });
  });

  test('creates pending identity from server-derived owner and profile metadata', async () => {
    const { client, query } = makeClient({ data: row, error: null });
    const store = createSupabaseAgentIdentityStore({ client });
    const result = await store.createForTenant('tenant-a', {
      tenantId: 'tenant-a',
      createdBy: 'user-a',
      ownerUserId: 'user-a',
      agentKey: 'engineer:field-engineer',
      name: 'Field Engineer',
      role: 'engineer',
      domain: 'network',
      capabilities: ['diagnostics.read'],
      approvalRequired: ['config.write'],
    });
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 'tenant-a',
      created_by_user_id: 'user-a',
      owner_user_id: 'user-a',
      agent_key: 'engineer:field-engineer',
      display_name: 'Field Engineer',
      status: 'pending',
      metadata: expect.objectContaining({ role: 'engineer', domain: 'network' }),
    }));
    expect(result.status).toBe('pending');
  });

  test('decommissions rather than deletes the identity', async () => {
    const { client, query } = makeClient({ data: { ...row, status: 'decommissioned' }, error: null });
    const store = createSupabaseAgentIdentityStore({ client });
    const result = await store.removeForTenant('tenant-a', row.id);
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'decommissioned', revoked_at: expect.any(String) }));
    expect(query.eq).toHaveBeenNthCalledWith(1, 'tenant_id', 'tenant-a');
    expect(query.eq).toHaveBeenNthCalledWith(2, 'id', row.id);
    expect(result.status).toBe('decommissioned');
  });

  test('fails closed when a server-derived owner or tenant is missing', async () => {
    const { client } = makeClient({ data: null, error: null });
    const store = createSupabaseAgentIdentityStore({ client });
    await expect(store.createForTenant('tenant-a', { name: 'No Owner', role: 'engineer' }))
      .rejects.toThrow('AGENT_OWNER_MEMBERSHIP_REQUIRED');
    await expect(store.getForTenant('', row.id)).rejects.toThrow('AGENT_TENANT_REQUIRED');
  });
});
