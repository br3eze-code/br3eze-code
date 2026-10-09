import { ToolRegistry, CapabilityBoundaryError } from '../../src/core/tool-registry.js';
import { TaskRegistry } from '../../src/core/taskRegistry.js';
import SkillRegistry from '../../src/core/skills/SkillRegistry.js';

describe('execution gate wiring', () => {
  const context = { tenantId: 'tenant-1', userId: 'user-1', authorizedCapabilities: ['procurement.commit'] };

  test('canonical ToolRegistry blocks execution without a task', async () => {
    const tasks = new TaskRegistry();
    const registry = new ToolRegistry({ taskRegistry: tasks });
    registry.register('procurement.commit', {
      risk: 'high',
      requiresApproval: true,
      handler: async () => 'committed',
    });
    await expect(registry.execute('procurement.commit', {}, context)).rejects.toBeInstanceOf(CapabilityBoundaryError);
  });

  test('mutation cannot bypass plan/draft/approval gates', async () => {
    const tasks = new TaskRegistry();
    const registry = new ToolRegistry({ taskRegistry: tasks });
    registry.register('procurement.commit', { risk: 'high', requiresApproval: true, permissions: ['procurement.commit'], handler: async () => 'committed' });
    const task = tasks.create('commit purchase', { action: 'procurement.commit', context });

    await expect(registry.execute('procurement.commit', {}, { ...context, taskId: task.taskId })).rejects.toBeInstanceOf(CapabilityBoundaryError);
    tasks.markPlanReady(task.taskId, { recommendation: 'approved supplier' });
    tasks.markDraftReady(task.taskId, { purchase: { supplier: 'supplier-1' } });
    await expect(registry.execute('procurement.commit', {}, { ...context, taskId: task.taskId })).rejects.toBeInstanceOf(CapabilityBoundaryError);
    tasks.approveExecution(task.taskId, 'approval-1');
    tasks.beginExecution(task.taskId);
    await expect(registry.execute('procurement.commit', {}, { ...context, taskId: task.taskId })).resolves.toBe('committed');
  });

  test('direct SkillRegistry execution uses the same boundary', async () => {
    const tasks = new TaskRegistry();
    const skills = new SkillRegistry({ taskRegistry: tasks });
    skills.register({ name: 'commerce', domain: 'commerce', capabilities: [{ id: 'commerce.read', phase: 'execute', risk: 'low' }] }, { execute: async () => 'read' });
    const task = tasks.create('read', { action: 'commerce.read', context });
    await expect(skills.execute('commerce', 'read', {}, { ...context, taskId: task.taskId })).resolves.toBe('read');
  });
});
