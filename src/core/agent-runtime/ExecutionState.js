import { randomUUID } from 'node:crypto';

export const ExecutionStatus = Object.freeze({
  CREATED: 'created', RUNNING: 'running', PAUSED: 'paused', WAITING: 'waiting',
  COMPLETED: 'completed', FAILED: 'failed', CANCELLED: 'cancelled'
});

export function createExecutionState({ executionId = randomUUID(), tenantId, userId, taskId = null, input = null, context = {}, metadata = {} } = {}) {
  if (!tenantId || !userId) throw new Error('tenantId and userId are required');
  return {
    executionId, tenantId, userId, taskId, status: ExecutionStatus.CREATED,
    step: 0, nodeId: null, input, output: null, context: structuredClone(context),
    metadata: structuredClone(metadata), history: [], createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), version: 0
  };
}

export function transitionExecution(state, status, patch = {}) {
  const next = { ...state, ...patch, status, step: state.step + 1,
    updatedAt: new Date().toISOString(), version: state.version + 1 };
  next.history = [...state.history, { step: next.step, status, nodeId: next.nodeId, at: next.updatedAt }];
  return next;
}
