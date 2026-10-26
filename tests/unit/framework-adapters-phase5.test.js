import { describe, expect, jest, test } from '@jest/globals';
import { AgentOSFrameworkAdapter, assertAdapterContract } from '../../src/adapters/frameworks/AgentOSFrameworkAdapter.js';
import { MCPAdapter } from '../../src/adapters/protocols/MCPAdapter.js';
import { A2AAdapter } from '../../src/adapters/protocols/A2AAdapter.js';

function fakeFactory() {
  const calls = [];
  const factory = {};
  for (const name of [
    'createAgent', 'runAgent', 'removeAgent', 'handoff', 'createChild',
    'defineWorkflow', 'runWorkflow', 'resumeWorkflow',
    'registerTool', 'executeTool', 'checkGuardrail',
    'readMemory', 'writeMemory', 'readTrace', 'evaluate',
  ]) {
    factory[name] = (...args) => {
      calls.push({ name, args });
      return { ok: true, name };
    };
  }
  factory.calls = calls;
  return factory;
}

describe('framework and protocol adapters', () => {
  test('framework adapter satisfies the AgentOS contract', async () => {
    const factory = fakeFactory();
    const adapter = new AgentOSFrameworkAdapter({ id: 'test', factory });

    expect(assertAdapterContract(adapter)).toBe(true);
    await adapter.runAgent({ id: 'a' }, { input: 'x' }, { tenantId: 't1', userId: 'u1' });
    await adapter.removeAgent('a', { tenantId: 't1', userId: 'u1' });
    expect(factory.calls.some((call) => call.name === 'runAgent')).toBe(true);
    expect(factory.calls.some((call) => call.name === 'removeAgent')).toBe(true);
  });

  test('MCP adapter requires and forwards tenant scope', async () => {
    let request;
    const adapter = new MCPAdapter({
      client: { listTools: async (value) => { request = value; return []; } },
    });

    await expect(adapter.listTools()).rejects.toThrow(/TENANT_SCOPE_REQUIRED/);
    await expect(adapter.listTools({ tenantId: 't1', userId: 'u1' })).resolves.toEqual([]);
    expect(request.tenantId).toBe('t1');
  });

  test('A2A adapter requires tenant scope and forwards the scoped context', async () => {
    let request;
    const adapter = new A2AAdapter({
      client: { sendTask: async (value) => { request = value; return value; } },
    });

    await expect(adapter.sendTask({ agent: 'a', input: 'x' })).rejects.toThrow(/TENANT_SCOPE_REQUIRED/);
    await adapter.sendTask({ agent: 'a', input: 'x', context: { tenantId: 't1', userId: 'u1' } });
    expect(request.context.tenantId).toBe('t1');
    expect(request.context.userId).toBe('u1');
  });
});
