import { describe, expect, test, jest } from '@jest/globals';
import { authorizeAgentTool, AgentAuthorizationError } from '../../src/core/agent-authorization.js';
import { AgentRuntime } from '../../src/core/agentRuntime.js';

const base = {
  agentId: 'agent-1', tenantId: 'tenant-a', userId: 'user-1', toolName: 'files.read',
  authorizer: async () => ({
    credentialValid: true,
    identity: { id: 'agent-1', tenantId: 'tenant-a', status: 'active' },
    policy: { id: 'p1', version: 3, active: true, effect: 'allow', capabilities: ['files.read'] },
  }),
};

describe('persistent agent authorization', () => {
  test('allows a valid active agent with an explicit capability', async () => {
    await expect(authorizeAgentTool(base)).resolves.toMatchObject({ agentId: 'agent-1', policyVersion: 3 });
  });

  test('fails closed without an authorizer', async () => {
    await expect(authorizeAgentTool({ ...base, authorizer: null }))
      .rejects.toMatchObject({ code: 'AGENT_AUTHORIZER_UNAVAILABLE' });
  });

  test('rejects missing, invalid, expired or revoked credentials', async () => {
    await expect(authorizeAgentTool({ ...base, authorizer: async () => ({ ...await base.authorizer(), credentialValid: false }) }))
      .rejects.toMatchObject({ code: 'AGENT_CREDENTIAL_INVALID' });
  });

  test('rejects cross-tenant identity substitution', async () => {
    await expect(authorizeAgentTool({ ...base, authorizer: async () => ({ ...await base.authorizer(), identity: { id: 'agent-1', tenantId: 'tenant-b', status: 'active' } }) }))
      .rejects.toMatchObject({ code: 'AGENT_IDENTITY_SCOPE_MISMATCH' });
  });

  test('rejects suspended identities and inactive or deny policies', async () => {
    await expect(authorizeAgentTool({ ...base, authorizer: async () => ({ ...await base.authorizer(), identity: { id: 'agent-1', tenantId: 'tenant-a', status: 'suspended' } }) }))
      .rejects.toMatchObject({ code: 'AGENT_IDENTITY_INACTIVE' });
    await expect(authorizeAgentTool({ ...base, authorizer: async () => ({ ...await base.authorizer(), policy: { active: true, effect: 'deny', capabilities: ['files.read'] } }) }))
      .rejects.toMatchObject({ code: 'AGENT_POLICY_DENIED' });
  });

  test('rejects capabilities not explicitly granted', async () => {
    await expect(authorizeAgentTool({ ...base, toolName: 'system.reboot' }))
      .rejects.toMatchObject({ code: 'AGENT_CAPABILITY_DENIED' });
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

  test('runtime invokes the identity authorizer before a tool', async () => {
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
