import { jest } from '@jest/globals';
import { TaskRegistry } from '../src/core/taskRegistry.js';
import { AgentTeamOrchestrator } from '../src/core/agent-team-orchestrator.js';
import { createA2AMessage } from '../src/core/a2a-task-protocol.js';

describe('AgentOS A2A task/WBS protocol', () => {
  test('correlates team delegation to taskId and running WBS step', async () => {
    const registry = new TaskRegistry();
    const task = registry.create('test mission', {
      action: 'assist.task',
      context: { tenantId: 'tenant-1', projectId: 'project-1', domain: 'test', userId: 'user-1' }
    });
    const orchestrator = new AgentTeamOrchestrator({ registry });
    orchestrator.form({
      taskId: task.taskId,
      members: [
        { agentId: 'planner', role: 'cpo', capabilities: ['catalog.read'] },
        { agentId: 'executor', role: 'cfo', capabilities: ['ledger.read'] }
      ]
    });
    orchestrator.start(task.taskId);
    const dispatched = await orchestrator.delegate({
      taskId: task.taskId,
      sender: { agentId: 'planner', role: 'cpo' },
      recipient: { agentId: 'executor', role: 'cfo' },
      capability: 'ledger.read'
    });
    expect(dispatched.result.taskId).toBe(task.taskId);
    expect(task.team.state).toBe('running');
    expect(task.wbs.find(step => step.status === 'running')).toBeTruthy();
  });

  test('rejects an A2A message with a missing task scope', () => {
    const registry = new TaskRegistry();
    const task = registry.create('test mission', { action: 'assist.task' });
    expect(() => createA2AMessage({
      taskId: task.taskId,
      sender: 'a', recipient: 'b', capability: 'catalog.read',
      fromRole: 'cpo', toRole: 'cfo', wbsId: task.wbs[0].id,
      scope: { tenantId: 't', projectId: 'p', domain: 'd' }
    })).toThrow(/Invalid A2A message/);
  });
});
