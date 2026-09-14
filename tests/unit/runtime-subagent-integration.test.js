import assert from 'node:assert/strict';
import { AgentRuntime } from '../../src/core/agentRuntime.js';
import SubagentRuntime from '../../src/core/subagentRuntime.js';
import { MemorySubagentStore } from '../../src/adapters/persistence/memory-subagent-store.js';

test('runtime narrows child permissions and preserves parent security scope', async () => {
  const subagents = new SubagentRuntime({ store: new MemorySubagentStore(), maxDepth: 2, defaultBudget: 10, executor: async ({ input }) => input });
  const runtime = new AgentRuntime({ subagentRuntime: subagents });
  const parent = subagents.spawn({
    role: 'planner',
    scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a', principalId: 'user-a' },
    permissions: ['catalog.read', 'order.create'],
  });
  const child = runtime.spawnSubagent({
    parentId: parent.id,
    role: 'procurement',
    scope: { tenantId: 'attacker-tenant', workspaceId: 'attacker-workspace', extra: 'allowed' },
    permissions: ['catalog.read', 'admin.delete'],
  });

  assert.equal(child.scope.tenantId, 'tenant-a');
  assert.equal(child.scope.workspaceId, 'workspace-a');
  assert.equal(child.scope.principalId, 'user-a');
  assert.equal(child.scope.extra, 'allowed');
  assert.deepEqual(child.permissions, ['catalog.read']);
  assert.equal((await runtime.runSubagent(child.id, 'ok')).ok ?? true, true);
});

test('runtime exposes explicit subagent lifecycle operations', () => {
  const subagents = new SubagentRuntime({ store: new MemorySubagentStore() });
  const runtime = new AgentRuntime({ subagentRuntime: subagents });
  const child = runtime.spawnSubagent({ role: 'qa', permissions: ['test.run'] });
  runtime.handoffSubagent(child.id, 'engineer', { reason: 'fix' });
  assert.equal(subagents.get(child.id).status, 'handoff');
  runtime.terminateSubagent(child.id, 'cancelled');
  assert.equal(subagents.get(child.id).status, 'terminated');
});
