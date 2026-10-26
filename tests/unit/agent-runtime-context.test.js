import { AgentRuntime } from '../../src/core/agentRuntime.js';
import { attachOnboardingWbs } from '../../src/core/onboarding-wbs.js';

describe('AgentRuntime canonical execution context', () => {
  test('forwards scoped identity context into tool execution', async () => {
    let received;
    const runtime = new AgentRuntime({
      toolRegistry: {
        getTool: () => ({ schema: { parameters: { type: 'object', properties: {} } } }),
        execute: async (name, args, context) => {
          received = { name, args, context };
          return { ok: true };
        },
        getManifest: () => ({ tools: [] })
      },
      sessionManager: { getSessionId: () => 'session-1' },
      memoryStore: { append: async () => {} },
      providerManager: {},
      safetyEnvelope: { checkToolExecution: () => true },
      maxIterations: 1
    });

    const results = await runtime.executeTools([
      { id: 'call-1', name: 'graph__snapshot', arguments: { graphId: 'project' } }
    ], {
      userId: 'user-a',
      tenantId: 'tenant-a',
      domain: 'workspace',
      siteId: 'site-1',
      locationPermission: false,
      channel: 'cli',
      content: 'snapshot graph'
    });

    expect(results).toEqual([{ toolCallId: 'call-1', result: { ok: true } }]);
    expect(received.context).toMatchObject({
      userId: 'user-a',
      tenantId: 'tenant-a',
      domain: 'workspace',
      siteId: 'site-1',
      locationPermission: false
    });
  });

  test('blocks role-specific mutations until explicit approval is present', async () => {
    let executions = 0;
    const approvalRecords = new Map();
    const approvalDb = {
      async set(key, value) { approvalRecords.set(key, structuredClone(value)); },
      async get(key) { return approvalRecords.has(key) ? structuredClone(approvalRecords.get(key)) : null; },
      async compareAndSet(key, expectedStatus, next) {
        const current = approvalRecords.get(key);
        if (!current || current.status !== expectedStatus) return false;
        approvalRecords.set(key, structuredClone(next));
        return true;
      },
    };
    const runtime = new AgentRuntime({
      toolRegistry: {
        getTool: () => ({ schema: { parameters: { type: 'object', properties: {} } } }),
        execute: async () => { executions += 1; return { ok: true }; },
        getManifest: () => ({ tools: [] })
      },
      sessionManager: { getSessionId: () => 'session-approval' },
      memoryStore: { append: async () => {} },
      providerManager: {},
      safetyEnvelope: { checkToolExecution: () => true },
      approvalOptions: { persistence: () => approvalDb },
      maxIterations: 1
    });

    const blocked = await runtime.executeTools([
      { id: 'call-approval-1', name: 'payment__create', arguments: {} }
    ], { userId: 'accountant-1', tenantId: 'tenant-a', domain: 'general', agentRole: 'accountant', channel: 'cli' });
    expect(blocked[0].result).toMatchObject({ approvalRequired: true, agentRole: 'accountant' });
    expect(executions).toBe(0);

    const spoofed = await runtime.executeTools([
      { id: 'call-approval-spoofed', name: 'payment__create', arguments: {} }
    ], { userId: 'accountant-1', tenantId: 'tenant-a', domain: 'general', agentRole: 'accountant', approved: true, channel: 'cli' });
    expect(spoofed[0].result).toMatchObject({ approvalRequired: true, agentRole: 'accountant' });
    expect(executions).toBe(0);
    const spoofedWithId = await runtime.executeTools([
      { id: 'call-approval-spoofed-id', name: 'payment__create', arguments: {} }
    ], { userId: 'accountant-1', tenantId: 'tenant-a', domain: 'general', agentRole: 'accountant', approvalGranted: true, approvalId: 'invented-id', channel: 'cli' });
    expect(spoofedWithId[0].result).toMatchObject({ approvalRequired: true, agentRole: 'accountant' });
    expect(executions).toBe(0);


    const approval = await runtime.approveAction({
      actionId: blocked[0].result.actionId,
      actor: 'admin-1',
      tenantId: 'tenant-a',
      authorize: async () => true,
    });
    expect(approval).toMatchObject({ status: 'EXECUTED', result: { ok: true } });
    expect(executions).toBe(1);
  });

  test('attaches a deterministic onboarding WBS without inferring location', () => {
    const frame = attachOnboardingWbs({
      userId: 'user-a',
      tenantId: 'tenant-a',
      domain: 'workspace',
      siteId: 'site-1',
      channel: 'cli',
      content: 'help me get started',
      location: { latitude: 1.2, longitude: 3.4 },
      consent: { location: false }
    });

    expect(frame.wbs.length).toBeGreaterThan(0);
    expect(frame.wbsSummary.total).toBe(frame.wbs.length);
    expect(frame.nextAction).toMatchObject({ key: 'understand', requiresApproval: false });
    expect(frame.wbs[0].context).toMatchObject({
      tenantId: 'tenant-a',
      userId: 'user-a',
      siteId: 'site-1'
    });
    expect(frame.location).toBeNull();
    expect(frame.locationPermission).toBe(false);
  });
});
