import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentOSFrameworkAdapter, assertAdapterContract } from '../../src/adapters/frameworks/AgentOSFrameworkAdapter.js';
import { MCPAdapter } from '../../src/adapters/protocols/MCPAdapter.js';
import { A2AAdapter } from '../../src/adapters/protocols/A2AAdapter.js';

function fakeFactory() {
  const calls = [];
  const ok = (name, value) => (...args) => { calls.push({ name, args }); return value ?? { ok: true, name }; };
  return { calls, createAgent: ok('createAgent'), runAgent: ok('runAgent'), handoff: ok('handoff'), createChild: ok('createChild'), defineWorkflow: ok('defineWorkflow'), runWorkflow: ok('runWorkflow'), resumeWorkflow: ok('resumeWorkflow'), registerTool: ok('registerTool'), executeTool: ok('executeTool'), checkGuardrail: ok('checkGuardrail'), readMemory: ok('readMemory'), writeMemory: ok('writeMemory'), readTrace: ok('readTrace'), evaluate: ok('evaluate') };
}

test('framework adapter satisfies AgentOS contract', async () => {
  const adapter = new AgentOSFrameworkAdapter({ id: 'test', factory: fakeFactory() });
  assert.equal(assertAdapterContract(adapter), true);
  await adapter.runAgent({ id: 'a' }, { input: 'x' }, { tenantId: 't' });
});

test('MCP adapter enforces tenant scope', async () => {
  const adapter = new MCPAdapter({ client: { listTools: async () => [] } });
  await assert.rejects(() => adapter.listTools(), /TENANT_SCOPE_REQUIRED/);
  assert.deepEqual(await adapter.listTools({ tenantId: 't1' }), []);
});

test('A2A adapter enforces tenant scope and forwards tenant context', async () => {
  let request;
  const adapter = new A2AAdapter({ client: { sendTask: async (value) => { request = value; return value; } } });
  await assert.rejects(() => adapter.sendTask({ agent: 'a', input: 'x' }), /TENANT_SCOPE_REQUIRED/);
  await adapter.sendTask({ agent: 'a', input: 'x', context: { tenantId: 't1', userId: 'u1' } });
  assert.equal(request.context.tenantId, 't1');
});
