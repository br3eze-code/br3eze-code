import { AgentRuntime } from '../../src/core/agent-runtime.js';

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
});
