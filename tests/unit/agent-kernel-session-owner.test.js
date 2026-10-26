import { describe, expect, test } from '@jest/globals';
import AgentKernel from '../../src/core/agentKernel.js';
import { SessionEventStore } from '../../src/core/session/SessionEventStore.js';
import { AgentRuntime } from '../../src/core/agentRuntime.js';
import { ToolRegistry } from '../../src/core/tool-registry.js';

describe('AgentKernel ownership boundary', () => {
  test('uses the injected SessionEventStore as the sole session owner', async () => {
    const store = new SessionEventStore();
    const runtime = new AgentRuntime({ toolRegistry: new ToolRegistry({ logger: { info() {}, warn() {}, error() {} } }) });
    const kernel = new AgentKernel({ sessionEventStore: store, runtime });
    const runtimeExecute = jest.spyOn(runtime, 'execute');
    const adapter = {
      name: 'test-domain',
      capabilities: ['ping'],
      requiresApproval: false,
      risk: 'low',
      execute: async (context) => ({ ok: true, tenantId: context.tenantId, userId: context.userId }),
    };

    kernel.registerDomain('test', adapter);
    kernel.init('/ignored/legacy/path.sqlite');

    let sessionId;
    kernel.on('dispatch:start', event => { sessionId = event.sessionId; });
    const result = await kernel.dispatch({ id: 'agent-1' }, {
      intent: { domain: 'test', text: 'ping' },
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    expect(result).toEqual({ ok: true, tenantId: 'tenant-1', userId: 'user-1' });
    expect(runtimeExecute).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Dispatch to test',
      context: expect.objectContaining({ tenantId: 'tenant-1', userId: 'user-1' }),
      toolCalls: [{ name: 'test.dispatch', arguments: {} }],
    }));
    const events = await store.read(sessionId);
    expect(events).toHaveLength(3);
    expect(events.map(event => event.type)).toEqual([
      'session/created',
      'session/running',
      'session/completed',
    ]);
  });

  test('does not create a private _sessions store', () => {
    const runtime = new AgentRuntime({ toolRegistry: new ToolRegistry() });
    const kernel = new AgentKernel({ runtime });
    expect(kernel._sessions).toBeUndefined();
    expect(kernel.sessionEventStore).toBeInstanceOf(SessionEventStore);
    expect(kernel.runtime).toBe(runtime);
  });
});


describe('AgentKernel agent ownership boundary', () => {
  test('delegates agent identity to the canonical AgentRegistry', () => {
    const kernel = new AgentKernel();
    const agent = kernel.registerAgent({
      id: 'router-agent',
      role: 'router',
      capabilities: ['network.inspect'],
    });

    expect(kernel.getAgent('router')).toBe(agent);
    expect(kernel.listAgents()).toEqual([agent]);
    expect(kernel.agents).toBeUndefined();
  });
});
