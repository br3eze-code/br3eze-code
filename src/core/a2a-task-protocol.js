import crypto from 'node:crypto';
import { getTaskRegistry } from './taskRegistry.js';
import { validateAgentosA2AMessage, normalizeAgentCell, emitAgentosA2AEvent } from './a2a-agentos-policy.js';

const MESSAGE_TYPES = Object.freeze(['delegate', 'handoff', 'progress', 'result', 'failure', 'cancel']);
const TEAM_STATES = Object.freeze(['forming', 'running', 'blocked', 'completed', 'failed', 'cancelled']);

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function requireTask(taskId) {
  const task = getTaskRegistry().get(taskId);
  if (!task) {
    const error = new Error(`Task not found: ${taskId}`);
    error.code = 'A2A_TASK_NOT_FOUND';
    throw error;
  }
  return task;
}

function currentWbsStep(task) {
  return (task.wbs || []).find(step => step.status === 'running') || null;
}

export function createAgentTeam({ taskId, members = [], name = null } = {}) {
  const task = requireTask(taskId);
  if (!Array.isArray(members) || members.length === 0) {
    throw new Error('Agent team requires at least one member');
  }
  const teamId = id('team');
  const normalized = members.map(member => ({
    agentId: String(member.agentId || member.id || '').trim(),
    role: normalizeAgentCell(member.role || 'specialist'),
    capabilities: Array.isArray(member.capabilities) ? [...member.capabilities] : [],
    status: 'ready'
  }));
  if (normalized.some(member => !member.agentId)) throw new Error('Every team member requires agentId');
  task.teamId = teamId;
  task.team = { teamId, name: name || teamId, state: 'forming', members: normalized, createdAt: Date.now() };
  task.updatedAt = Date.now();
  getTaskRegistry().emit('team:created', task);
  return task.team;
}

export function startAgentTeam(taskId) {
  const task = requireTask(taskId);
  if (!task.team) throw new Error('Task has no agent team');
  task.team.state = 'running';
  task.status = 'running';
  task.updatedAt = Date.now();
  getTaskRegistry().emit('team:started', task);
  return task.team;
}

export function createA2AMessage({ taskId, sender, recipient, capability, type = 'delegate', fromRole, toRole, scope, wbsId, handoffId = null, payload = {}, approval = null } = {}) {
  const task = requireTask(taskId);
  if (!MESSAGE_TYPES.includes(type)) throw new Error(`Unsupported A2A message type: ${type}`);
  const step = (task.wbs || []).find(item => item.id === wbsId) || currentWbsStep(task);
  const message = {
    protocol: 'agentos-a2a/1.0',
    messageId: id('msg'),
    type,
    sender,
    recipient,
    traceId: id('trace'),
    taskId,
    capability,
    task: {
      taskId,
      capability,
      agentos: {
        fromRole,
        toRole,
        wbsId: step?.id || wbsId,
        handoffId: handoffId || id('handoff'),
        scope: scope || task.scope,
        approval
      }
    },
    payload,
    createdAt: new Date().toISOString()
  };
  const validation = validateAgentosA2AMessage(message);
  if (!validation.valid) {
    const error = new Error(`Invalid A2A message: ${validation.errors.join(', ')}`);
    error.code = 'A2A_MESSAGE_INVALID';
    error.details = validation;
    throw error;
  }
  return Object.freeze({ ...message, validation });
}

export function dispatchA2A({ message, transport = null } = {}) {
  if (!message?.taskId) throw new Error('A2A dispatch requires taskId');
  const event = emitAgentosA2AEvent(`a2a.${message.type}`, { message });
  if (typeof transport === 'function') return Promise.resolve(transport(message)).then(result => ({ event, result }));
  return Promise.resolve({ event, result: { accepted: true, messageId: message.messageId, taskId: message.taskId } });
}

export function handoffWbsStep({ taskId, fromAgent, toAgent, capability, scope, payload = {}, approval = null } = {}) {
  const task = requireTask(taskId);
  const step = currentWbsStep(task);
  if (!step) throw new Error('No running WBS step available for handoff');
  const message = createA2AMessage({
    taskId, sender: fromAgent, recipient: toAgent, capability,
    type: 'handoff', fromRole: fromAgent.role, toRole: toAgent.role,
    scope: scope || task.scope, wbsId: step.id, payload, approval
  });
  getTaskRegistry().appendOutput(taskId, 'agent', `A2A handoff ${message.messageId}: ${fromAgent.agentId} -> ${toAgent.agentId}`);
  emitAgentosA2AEvent('a2a.handoff.created', { taskId, messageId: message.messageId, wbsId: step.id });
  return message;
}

export function completeAgentWbsStep({ taskId, stepId, agentId, result = null } = {}) {
  const task = requireTask(taskId);
  const step = (task.wbs || []).find(item => item.id === stepId);
  if (!step) throw new Error(`WBS step not found: ${stepId}`);
  const updated = getTaskRegistry().completeWbsStep(taskId, stepId, result);
  emitAgentosA2AEvent('a2a.wbs.completed', { taskId, stepId, agentId, result });
  return updated;
}

export function getTeamTask(taskId) {
  const task = requireTask(taskId);
  return {
    taskId: task.taskId,
    status: task.status,
    team: task.team || null,
    wbs: task.wbs,
    wbsSummary: task.wbsSummary,
    currentStep: currentWbsStep(task)
  };
}

export { MESSAGE_TYPES, TEAM_STATES };
export default { createAgentTeam, startAgentTeam, createA2AMessage, dispatchA2A, handoffWbsStep, completeAgentWbsStep, getTeamTask };
