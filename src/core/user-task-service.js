import { getTaskRegistry, TaskStatus } from './taskRegistry.js';

const canManageAll = (context = {}) => ['admin', 'owner', 'tenant_admin', 'reseller'].includes(String(context.role || context.userDoc?.role || '').toLowerCase());

function normalizeScope(context = {}) {
  return {
    tenantId: context.tenantId || context.userDoc?.tenantId || null,
    domainId: context.domainId || context.userDoc?.domainId || null,
    siteId: context.siteId || context.userDoc?.siteId || null,
    channel: context.channel || null,
    userId: context.userId || null
  };
}

function assertTaskAccess(task, context = {}) {
  if (!task) throw Object.assign(new Error('Task not found'), { code: 'TASK_NOT_FOUND', status: 404 });
  const scope = normalizeScope(context);
  const sameScope = ['tenantId', 'domainId', 'siteId'].every((key) => !task.scope?.[key] || !scope[key] || task.scope[key] === scope[key]);
  const owner = task.scope?.userId === scope.userId || task.owner?.userId === scope.userId;
  if (!sameScope || (!owner && !canManageAll(context))) {
    throw Object.assign(new Error('Task is outside your authorized scope'), { code: 'TASK_FORBIDDEN', status: 403 });
  }
  return task;
}

export function createUserTask({ prompt, action = 'assist.task', description = null, context = {}, input = {} } = {}) {
  if (!prompt || typeof prompt !== 'string') throw Object.assign(new Error('Task prompt is required'), { code: 'TASK_INPUT_INVALID', status: 400 });
  const registry = getTaskRegistry();
  const scope = normalizeScope(context);
  return registry.create(prompt.trim().slice(0, 4000), {
    action,
    description: description || `${action}: ${prompt.trim().slice(0, 80)}`,
    owner: { userId: scope.userId, platformId: context.platformId || null },
    context,
    teamId: context.tenantId || null,
    wbs: undefined,
    input
  });
}

export function listUserTasks(context = {}, { status = null } = {}) {
  const registry = getTaskRegistry();
  const scope = normalizeScope(context);
  return canManageAll(context)
    ? registry.list(status, scope)
    : registry.listForUser(scope.userId, scope);
}

export function getUserTask(taskId, context = {}) {
  return assertTaskAccess(getTaskRegistry().get(taskId), context);
}

export function stopUserTask(taskId, context = {}) {
  const task = assertTaskAccess(getTaskRegistry().get(taskId), context);
  if (![TaskStatus.CREATED, TaskStatus.RUNNING].includes(task.status)) {
    throw Object.assign(new Error(`Task is not active: ${task.status}`), { code: 'TASK_NOT_ACTIVE', status: 409 });
  }
  getTaskRegistry().stop(taskId);
  return getTaskRegistry().get(taskId);
}

export function updateUserTaskStep(taskId, stepId, patch, context = {}) {
  assertTaskAccess(getTaskRegistry().get(taskId), context);
  const task = getTaskRegistry().updateWbs(taskId, stepId, patch);
  if (!task) throw Object.assign(new Error('Task not found'), { code: 'TASK_NOT_FOUND', status: 404 });
  return task;
}

export { normalizeScope, assertTaskAccess };
export default { createUserTask, listUserTasks, getUserTask, stopUserTask, updateUserTaskStep };

