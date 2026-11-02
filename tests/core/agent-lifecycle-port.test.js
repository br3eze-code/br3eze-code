import { describe, expect, test, jest } from '@jest/globals';
import { createAgentLifecyclePort, normalizeAgentDefinition } from '../../src/core/ports/agent-lifecycle.js';
import { createTenantScopedAgentRegistry } from '../../src/adapters/agents/tenant-scoped-registry.js';

function setup(overrides = {}) {
  const agents = new Map();
  const order = [];
  const registry = {
    create: jest.fn(async (definition, context) => {
      order.push('create');
      const agent = { id: 'agent-a', ...definition };
      agents.set(agent.id, agent);
      return agent;
    }),
    get: jest.fn(async (id) => agents.get(id) || null),
    remove: jest.fn(async (id) => agents.delete(id)),
  };
  const executeAgent = jest.fn(async ({ agent, input }) => ({ agentId: agent.id, output: input }));
  const authorize = jest.fn(async () => { order.push('authorize'); return true; });
  const requestApproval = jest.fn(async () => { order.push('approval'); return true; });
  return { port: createAgentLifecyclePort({ registry, executeAgent, authorize, requestApproval, ...overrides }), registry, executeAgent, authorize, requestApproval, order };
}
const context = { tenantId: 'tenant-a', userId: 'user-a', requestId: 'req-1' };
const definition = { name: 'Field Engineer', role: 'engineer', domain: 'network' };

describe('agent lifecycle port', () => {
  test('agent.get requires authorization and returns an explicit not-found result', async () => {
    const s = setup();
    await s.port.create({ definition, context });
    const result = await s.port.get({ agentId: 'agent-a', context });
    expect(result).toMatchObject({ capability: 'agent.get', status: 'found', agent: { id: 'agent-a' } });
    const missing = await s.port.get({ agentId: 'missing', context });
    expect(missing).toMatchObject({ capability: 'agent.get', status: 'not_found' });
    const denied = setup({ authorize: async () => false });
    await expect(denied.port.get({ agentId: 'agent-a', context })).rejects.toThrow('AGENT_GET_FORBIDDEN');
  });

  test('agent.call delegates to the canonical runtime executor', async () => {
    const s = setup();
    await s.port.create({ definition, context });
    const result = await s.port.call({ agentId: 'agent-a', input: { task: 'report status' }, context });
    expect(result).toEqual({ agentId: 'agent-a', output: { task: 'report status' } });
    expect(s.executeAgent).toHaveBeenCalledTimes(1);
    const denied = setup({ authorize: async () => false });
    await expect(denied.port.call({ agentId: 'agent-a', input: 'x', context })).rejects.toThrow('AGENT_CALL_FORBIDDEN');
    expect(denied.executeAgent).not.toHaveBeenCalled();
  });

  test('creates only after authorization and approval, with a stable role/name key', async () => {
    const s = setup();
    const result = await s.port.create({ definition, context });
    expect(result.status).toBe('created');
    expect(s.order.indexOf('authorize')).toBeLessThan(s.order.indexOf('approval'));
    expect(s.order.indexOf('approval')).toBeLessThan(s.order.indexOf('create'));
    expect(s.registry.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Field Engineer',
      role: 'engineer',
      agentKey: 'engineer:field-engineer',
      tenantId: 'tenant-a',
      createdBy: 'user-a',
      capabilities: expect.arrayContaining(['diagnostics.read', 'code.read']),
    }), context);
  });

  test('role profiles cannot be used to self-grant permissions or resource scopes', async () => {
    expect(() => normalizeAgentDefinition({
      ...definition,
      capabilities: ['*'],
    }, context)).toThrow('AGENT_AUTHORITY_SERVER_MANAGED');
    expect(() => normalizeAgentDefinition({
      ...definition,
      resourceScopes: ['tenant:*'],
    }, context)).toThrow('AGENT_AUTHORITY_SERVER_MANAGED');
    expect(() => normalizeAgentDefinition({
      ...definition,
      role: 'administrator',
    }, context)).toThrow('AGENT_ROLE_UNSUPPORTED');
  });

  test('tenant-scoped registry receives the authenticated context on create', async () => {
    const rows = new Map();
    const store = {
      getForTenant: jest.fn(async (tenantId, id) => rows.get(`${tenantId}:${id}`) || null),
      createForTenant: jest.fn(async (tenantId, input) => {
        const row = { id: 'persisted-agent-id', ...input, tenantId };
        rows.set(`${tenantId}:${row.id}`, row);
        return row;
      }),
      removeForTenant: jest.fn(async (tenantId, id) => rows.get(`${tenantId}:${id}`) || null),
    };
    const registry = createTenantScopedAgentRegistry({ store });
    const s = setup({ registry });
    await s.port.create({ definition, context });
    expect(store.createForTenant).toHaveBeenCalledWith('tenant-a', expect.objectContaining({
      agentKey: 'engineer:field-engineer',
      tenantId: 'tenant-a',
      createdBy: 'user-a',
    }));
  });

  test('runs through the host-injected canonical runtime executor', async () => {
    const s = setup();
    await s.port.create({ definition, context });
    const result = await s.port.run({ agentId: 'agent-a', input: 'hello', context });
    expect(result).toEqual({ agentId: 'agent-a', output: 'hello' });
    expect(s.executeAgent).toHaveBeenCalledWith(expect.objectContaining({ agent: expect.objectContaining({ id: 'agent-a' }), input: 'hello' }));
  });

  test('fails closed when authorization or approval is denied', async () => {
    const denied = setup({ authorize: async () => false });
    await expect(denied.port.create({ definition, context })).rejects.toThrow('AGENT_CREATE_FORBIDDEN');
    expect(denied.registry.create).not.toHaveBeenCalled();
    const unapproved = setup({ requestApproval: async () => false });
    await expect(unapproved.port.remove({ agentId: 'a', reason: 'retire', context })).rejects.toThrow('AGENT_REMOVE_APPROVAL_REQUIRED');
    expect(unapproved.registry.remove).not.toHaveBeenCalled();
  });

  test('requires tenant/user identity and reason for removal', async () => {
    const s = setup();
    await expect(s.port.run({ agentId: 'a', input: 'x', context: {} })).rejects.toThrow('AGENT_IDENTITY_REQUIRED');
    await expect(s.port.remove({ agentId: 'a', reason: '', context })).rejects.toThrow('AGENT_REMOVE_REASON_REQUIRED');
  });
});
