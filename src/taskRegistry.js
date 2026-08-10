
import crypto from 'crypto';

// src/taskRegistry.js — task registry for the agentRuntime
const TaskStatus = Object.freeze({ PENDING: 'pending', RUNNING: 'running', DONE: 'done', FAILED: 'failed' });
const _tasks = new Map();
function getTaskRegistry() {
  return {
    create(task) { const t = { ...task, id: task.id || crypto.randomUUID().slice(0,8), status: TaskStatus.PENDING, createdAt: Date.now() }; _tasks.set(t.id, t); return t; },
    get(id) { return _tasks.get(id) || null; },
    update(id, patch) { const t = _tasks.get(id); if (t) _tasks.set(id, { ...t, ...patch }); return _tasks.get(id); },
    list(filter = {}) { let items = [..._tasks.values()]; if (filter.status) items = items.filter(t => t.status === filter.status); return items; },
    clear() { _tasks.clear(); },
  };
}
export { getTaskRegistry, TaskStatus };