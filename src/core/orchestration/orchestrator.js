import { getTaskRegistry, TaskStatus } from '../taskRegistry.js';
import { LoopEngine } from './loop-engine.js';

export class AgentOSOrchestrator {
  constructor({ taskRegistry = getTaskRegistry(), loopEngine = new LoopEngine() } = {}) { this.taskRegistry = taskRegistry; this.loopEngine = loopEngine; }

  async runWork({ workId, goal, acceptanceCriteria, tenantId, projectId = null, specialist = null, owner = null, plan, execute, verify }) {
    const task = this.taskRegistry.create(goal, { action: 'agentos.loop', teamId: specialist, owner, context: { tenantId, projectId }, input: { workId, acceptanceCriteria } });
    this.taskRegistry.setStatus(task.taskId, TaskStatus.RUNNING, 'Loop execution started');
    const state = this.loopEngine.createState({ workId, taskId: task.taskId, tenantId, projectId, specialist, goal, acceptanceCriteria });
    const result = await this.loopEngine.run({ state, plan, execute, verify });
    this.taskRegistry.update(task.taskId, { loopId: state.loopId, executionState: result.state, evidence: result.evidence, trace: result.trace, acceptanceCriteria: state.work.acceptanceCriteria });
    this.taskRegistry.setStatus(task.taskId, result.status === 'completed' ? TaskStatus.COMPLETED : TaskStatus.FAILED, result.status);
    return { taskId: task.taskId, loopId: state.loopId, result };
  }
}
