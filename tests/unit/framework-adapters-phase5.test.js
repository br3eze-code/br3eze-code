import { describe, expect, test } from '@jest/globals';
import { AgentOSFrameworkAdapter, assertAdapterContract } from '../../src/adapters/frameworks/AgentOSFrameworkAdapter.js';
import { MCPAdapter } from '../../src/adapters/protocols/MCPAdapter.js';
import { A2AAdapter } from '../../src/adapters/protocols/A2AAdapter.js';

function fakeFactory() {
  const calls = [];
  const factory = {};
  for (const name of ['createAgent','runAgent','handoff','createChild','defineWorkflow','runWorkflow','resumeWorkflow','registerTool','executeTool','checkGuardrail','readMemory','writeMemory','readTrace','evaluate']) {
    factory[name] = (...args) => { calls.push({ name, args }); return { ok: true, name }; };
  }
  factory.calls = calls;
  return factory;
}

describe('AgentOS framework and protocol adapters', () => {
  test('framework adapter satisfies AgentOS contract', async () => {
    const adapter = new AgentOSFrameworkAdapter({ id: 'test', factory: fakeFactory() });
    expect(assertAdapterContract(adapter)).toBe(true);
    await expect(adapter.runAgent({ id: 'a' }, { input: 'x' }, { tenantId: 't' })).resolves.toMatchObject({ ok: true, name: 'runAgent' });
  });

  test('MCP adapter enforces tenant scope and forwards tenant', async () => {
    let request;
    const adapter = new MCPAdapter({ client: { listTools: async (value) => { request = value; return []; } } });
    await expect(adapter.listTools()).rejects.toThrow('TENANT_SCOPE_REQUIRED');
    await expect(adapter.listTools({ tenantId: 't1' })).resolves.toEqual([]);
    expect(request.tenantId).toBe('t1');
  });

  test('A2A adapter enforces tenant scope', async () => {
    let request;
    const adapter = new A2AAdapter({ client: { sendTask: async (value) => { request = value; return value; } } });
    await expect(adapter.sendTask({ agent: 'a', input: 'x' })).rejects.toThrow('TENANT_SCOPE_REQUIRED');
    await adapter.sendTask({ agent: 'a', input: 'x', context: { tenantId: 't1', userId: 'u1' } });
    expect(request.context.tenantId).toBe('t1');
  });
});
