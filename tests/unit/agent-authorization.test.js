import { describe, expect, test, jest } from '@jest/globals';
import { authorizeAgentTool } from '../../src/core/agent-authorization.js';
import { AgentRuntime } from '../../src/core/agentRuntime.js';

const base = {
  agentId: 'agent-1', tenantId: 'tenant-a', userId: 'user-1', toolName: 'files.read',
  authorizer: async () => ({
    credentialValid: true,
    identity: { id: 'agent-1', tenantId: 'tenant-a', status: 'active' },
    membership: { id: 'membership-1', userId: 'user-1', tenantId: 'tenant-a', role: 'operator', status: 'active' },
    policy: { id: 'p1', version: 3, active: true, effect: 'allow', capabilities: ['files.read'] },
  }),
};

describe('canonical persistent agent authorization', () => {
  test('allows an active agent with verified human membership and an exact capability', async () => {
    await expect(authorizeAgentTool(base)).resolves.toMatchObject({
      agentId: 'agent-1', policyVersion: 3, membershipRole: 'operator',
    });
  });

  test('fails closed without an authorizer', async () => {
    await expect(authorizeAgentTool({ ...base, authorizer: null }))
      .rejects.toMatchObject({ code: 'AGENT_AUTHORIZER_UNAVAILABLE' });
  });

  test('rejects missing, invalid, expired or revoked credentials', async () => {
    await expect(authorizeAgentTool({
      ...base, authorizer: async () => ({ ...await base.authorizer(), credentialValid: false }),
    })).rejects.toMatchObject({ code: 'AGENT_CREDENTIAL_INVALID' });
  });

  test('rejects cross-tenant identity substitution', async () => {
    await expect(authorizeAgentTool({
      ...base,
      authorizer: async () => ({ ...await base.authorizer(), identity: { id: 'agent-1', tenantId: 'tenant-b', status: 'active' } }),
    })).rejects.toMatchObject({ code: 'AGENT_IDENTITY_SCOPE_MISMATCH' });
  });

  test('rejects missing, inactive or cross-tenant human membership', async () => {
    for (const membership of [
      null,
      { id: 'm1', userId: 'user-1', tenantId: 'tenant-a', role: 'owner', status: 'suspended' },
      { id: 'm1', userId: 'user-1', tenantId: 'tenant-b', role: 'owner', status: 'active' },
      { id: 'm1', userId: 'someone-else', tenantId: 'tenant-a', role: 'owner', status: 'active' },
    ]) {
      await expect(authorizeAgentTool({
        ...base, authorizer: async () => ({ ...await base.authorizer(), membership }),
      })).rejects.toMatchObject({ code: 'AGENT_MEMBERSHIP_DENIED' });
    }
  });

  test('rejects suspended identities and inactive or deny policies', async () => {
    await expect(authorizeAgentTool({
      ...base, authorizer: async () => ({ ...await base.authorizer(), identity: { id: 'agent-1', tenantId: 'tenant-a', status: 'suspended' } }),
    })).rejects.toMatchObject({ code: 'AGENT_IDENTITY_INACTIVE' });
    await expect(authorizeAgentTool({
      ...base, authorizer: async () => ({ ...await base.authorizer(), policy: { active: true, effect: 'deny', capabilities: ['files.read'] } }),
    })).rejects.toMatchObject({ code: 'AGENT_POLICY_DENIED' });
  });

  test('rejects ungranted tools and wildcard escalation', async () => {
    for (const capabilities of [[], ['*'], ['files.*']]) {
      await expect(authorizeAgentTool({
        ...base, authorizer: async () => ({ ...await base.authorizer(), policy: { active: true, effect: 'allow', capabilities } }),
      })).rejects.toMatchObject({ code: 'AGENT_CAPABILITY_DENIED' });
    }
  });

  test('requires explicit resource authorization when a resource is targeted', async () => {
    await expect(authorizeAgentTool({ ...base, params: { resourceId: 'station-1' } }))
      .rejects.toMatchObject({ code: 'AGENT_RESOURCE_SCOPE_DENIED' });
    await expect(authorizeAgentTool({
      ...base,
      params: { resourceId: 'station-1' },
      authorizer: async () => ({ ...await base.authorizer(), resourceAuthorized: true }),
    })).resolves.toMatchObject({ resourceId: 'station-1' });
  });

  test('runtime blocks agent execution without a configured identity authorizer', async () => {
    const execute = jest.fn(async () => ({ ok: true }));
    const registry = { getTool: () => ({ capability: {} }), execute };
    const runtime = new AgentRuntime({ toolRegistry: registry });
    await expect(runtime.executeTool('files.read', {}, {
      principalType: 'agent', agentId: 'agent-1', tenantId: 'tenant-a', userId: 'user-1',
    })).rejects.toMatchObject({ code: 'AGENT_AUTHORIZER_UNAVAILABLE' });
    expect(execute).not.toHaveBeenCalled();
  });

  test('runtime invokes the canonical authorizer before tool execution', async () => {
    const execute = jest.fn(async () => ({ ok: true }));
    const registry = { getTool: () => ({ capability: {} }), execute };
    const authorizer = jest.fn(base.authorizer);
    const runtime = new AgentRuntime({ toolRegistry: registry, agentIdentityAuthorizer: authorizer });
    await expect(runtime.executeTool('files.read', {}, {
      principalType: 'agent', agentId: 'agent-1', tenantId: 'tenant-a', userId: 'user-1',
    })).resolves.toEqual({ ok: true });
    expect(authorizer).toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
