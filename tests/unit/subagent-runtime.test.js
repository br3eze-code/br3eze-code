import assert from 'node:assert/strict';
import SubagentRuntime from '../../src/core/subagentRuntime.js';
import { MemorySubagentStore } from '../../src/adapters/persistence/memory-subagent-store.js';

test('spawns subagents with scope, permissions, depth and budget', () => {
  const runtime = new SubagentRuntime({ store: new MemorySubagentStore(), maxDepth: 2, defaultBudget: 10 });
  const root = runtime.spawn({ role: 'Planner', scope: { project: 'x' }, permissions: ['read'] });
  const child = runtime.spawn({ parentId: root.id, role: 'Engineer' });
  assert.equal(root.depth, 0);
  assert.equal(child.depth, 1);
  assert.deepEqual(root.permissions, ['read']);
  assert.deepEqual(child.permissions, ['read']);
});

test('prevents child permission and protected-scope widening at the lifecycle boundary', () => {
  const runtime = new SubagentRuntime({ store: new MemorySubagentStore() });
  const root = runtime.spawn({
    role: 'Planner',
    scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a', principalId: 'principal-a', project: 'x' },
    permissions: ['read', 'write'],
  });
  const child = runtime.spawn({
    parentId: root.id,
    role: 'Engineer',
    scope: { tenantId: 'tenant-b', workspaceId: 'workspace-b', principalId: 'principal-b', project: 'y' },
    permissions: ['write', 'delete'],
  });
  assert.deepEqual(child.permissions, ['write']);
  assert.equal(child.scope.tenantId, 'tenant-a');
  assert.equal(child.scope.workspaceId, 'workspace-a');
  assert.equal(child.scope.principalId, 'principal-a');
  assert.equal(child.scope.project, 'y');
});

test('enforces maximum spawn depth', () => {
  const runtime = new SubagentRuntime({ store: new MemorySubagentStore(), maxDepth: 1 });
  const root = runtime.spawn({ role: 'Planner' });
  const child = runtime.spawn({ parentId: root.id, role: 'Engineer' });
  assert.throws(() => runtime.spawn({ parentId: child.id, role: 'QA' }), (error) => error.code === 'SUBAGENT_DEPTH_EXCEEDED');
});

test('enforces budget and tracks successful execution', async () => {
  const runtime = new SubagentRuntime({ store: new MemorySubagentStore(), defaultBudget: 3, executor: async ({ input }) => ({ ok: input }) });
  const agent = runtime.spawn({ role: 'Engineer' });
  assert.deepEqual(await runtime.run(agent.id, 'work', { cost: 2 }), { ok: 'work' });
  assert.equal(runtime.get(agent.id).spent, 2);
  assert.equal(runtime.get(agent.id).status, 'completed');
  await assert.rejects(runtime.run(agent.id, 'again'), /is completed/);
});

test('terminating a parent terminates active descendants', () => {
  const runtime = new SubagentRuntime({ store: new MemorySubagentStore() });
  const root = runtime.spawn({ role: 'Planner' });
  const child = runtime.spawn({ parentId: root.id, role: 'Engineer' });
  const grandchild = runtime.spawn({ parentId: child.id, role: 'QA' });
  runtime.terminate(root.id, 'cancelled');
  assert.equal(runtime.get(root.id).status, 'terminated');
  assert.equal(runtime.get(child.id).status, 'terminated');
  assert.equal(runtime.get(grandchild.id).status, 'terminated');
});

test('supports handoff and termination', () => {
  const runtime = new SubagentRuntime({ store: new MemorySubagentStore() });
  const agent = runtime.spawn({ role: 'Planner' });
  assert.equal(runtime.handoff(agent.id, 'Engineer', { task: 'implement' }).status, 'handoff');
  assert.equal(runtime.terminate(agent.id, 'cancelled').status, 'terminated');
});
