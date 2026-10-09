import { createAgentTeam, startAgentTeam, createA2AMessage, dispatchA2A, completeAgentWbsStep } from './a2a-task-protocol.js';
import { getTaskRegistry } from './taskRegistry.js';

/**
 * AgentTeamOrchestrator is deliberately transport-neutral. A team member may
 * live in-process, behind HTTP, WebSocket, MCP, or another A2A transport.
 * taskId + WBS step id are the correlation contract across all transports.
 */
export class AgentTeamOrchestrator {
  constructor({ transport = null, registry = getTaskRegistry() } = {}) {
    this.transport = transport;
    this.registry = registry;
  }

  form({ taskId, members, name }) {
    return createAgentTeam({ taskId, members, name });
  }

  start(taskId) {
    return startAgentTeam(taskId);
  }

  async delegate({ taskId, sender, recipient, capability, payload = {}, approval = null }) {
    const task = this.registry.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    const step = (task.wbs || []).find(item => item.status === 'running');
    if (!step) throw new Error(`Task ${taskId} has no runnable WBS step`);
    const message = createA2AMessage({
      taskId,
      sender: sender.agentId,
      recipient: recipient.agentId,
      capability,
      type: 'delegate',
      fromRole: sender.role,
      toRole: recipient.role,
      scope: task.scope,
      wbsId: step.id,
      payload,
      approval
    });
    return dispatchA2A({ message, transport: this.transport });
  }

  complete({ taskId, stepId, agentId, result }) {
    return completeAgentWbsStep({ taskId, stepId, agentId, result });
  }
}

export default AgentTeamOrchestrator;
