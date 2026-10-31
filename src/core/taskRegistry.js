import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import EventEmitter from 'events';
import { createActionWbs, updateActionWbs, summarizeActionWbs } from './action-wbs.js';
import { createNextActionProposal } from './next-action-planner.js';
import path from 'node:path';
import { STATE_PATH } from './config.js';
import { FileTaskStore } from './file-task-store.js';

const TaskStatus = Object.freeze({ CREATED: 'created', RUNNING: 'running', COMPLETED: 'completed', FAILED: 'failed', STOPPED: 'stopped' });
const TaskPhase = Object.freeze({ PLAN: 'plan', DRAFT: 'draft', APPROVE: 'approve', EXECUTE: 'execute', OBSERVE: 'observe', VERIFY: 'verify', COMPLETE: 'complete' });
const TERMINAL_STATUSES = new Set([TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.STOPPED]);

function scopeMatches(task, scope = {}) {
  return ['tenantId', 'domainId', 'siteId', 'userId'].every((key) => !scope[key] || task.scope?.[key] === scope[key]);
}

class TaskRegistry extends EventEmitter {
  constructor({ store = null, staleAfterMs = 30 * 60 * 1000, clock = () => Date.now() } = {}) {
    super(); this.tasks = new Map(); this.idempotencyKeys = new Map(); this.counter = 0; this.store = store; this.staleAfterMs = staleAfterMs; this.clock = clock;
    if (this.store?.list) this.hydrate(this.store.list());
  }

  create(prompt, { description = null, teamId = null, action = null, owner = null, context = {}, wbs = null, input = {}, requiresExecutionApproval = false, idempotencyKey = null } = {}) {
    if (!context?.tenantId || !context?.userId) throw new Error('authenticated tenant context required');
    if (idempotencyKey != null && (typeof idempotencyKey !== 'string' || idempotencyKey.length < 1 || idempotencyKey.length > 200 || !/^[\x21-\x7E]+$/.test(idempotencyKey))) throw new TypeError('Invalid idempotency key');
    const requestHash = createHash('sha256').update(JSON.stringify({ prompt, action, teamId, tenantId: context.tenantId, userId: context.userId, domainId: context.domainId || null, siteId: context.siteId || null, input })).digest('hex');
    if (idempotencyKey && this.idempotencyKeys.has(idempotencyKey)) {
      const existing = this.tasks.get(this.idempotencyKeys.get(idempotencyKey)) || this.store?.get?.(this.idempotencyKeys.get(idempotencyKey));
      if (!existing || !scopeMatches(existing, { tenantId: context.tenantId, userId: context.userId })) throw Object.assign(new Error('Idempotency key is already used outside this task scope'), { code: 'IDEMPOTENCY_SCOPE_CONFLICT', status: 409 });
      if (existing.requestHash !== requestHash) throw Object.assign(new Error('Idempotency key was already used for a different request'), { code: 'IDEMPOTENCY_PAYLOAD_CONFLICT', status: 409 });
      return existing;
    }
    const taskId = uuidv4(), now = this.clock();
    const taskWbs = wbs || createActionWbs(action || 'assist.task', { context, input: { text: prompt, action, ...input } });
    const task = {
      taskId, prompt, description, status: TaskStatus.CREATED, createdAt: now, updatedAt: now, messages: [], output: '', teamId, action,
      idempotencyKey, requestHash,
      owner: owner ? { userId: owner.userId || null, platformId: owner.platformId || null } : null,
      scope: { tenantId: context.tenantId, domainId: context.domainId || null, siteId: context.siteId || null, userId: context.userId, channel: context.channel || null },
      wbs: taskWbs, wbsSummary: summarizeActionWbs(taskWbs),
      planningContext: { ...context, tenantId: context.tenantId, userId: context.userId, authorizedCapabilities: Array.isArray(context.authorizedCapabilities || context.capabilities) ? [...(context.authorizedCapabilities || context.capabilities)] : [] },
      execution: { phase: TaskPhase.PLAN, planReady: false, draftReady: false, approvalRequired: Boolean(requiresExecutionApproval), approved: false, approvalId: null, executionStartedAt: null, verifiedAt: null },
      checkpoints: [], nextActionProposal: null
    };
    task.nextActionProposal = createNextActionProposal({ task, context, now }); this.tasks.set(taskId, task); if (idempotencyKey) this.idempotencyKeys.set(idempotencyKey, taskId); this.counter++; this._persist(task, 'task.created'); this.emit('task:created', task); return task;
  }

  _persist(task, type = 'task.updated', details = {}) {
    if (!Array.isArray(task.events)) task.events = [];
    const event = { eventId: uuidv4(), taskId: task.taskId, type, timestamp: this.clock(), status: task.status, phase: task.execution?.phase || null, ...details };
    task.events.push(event);
    this.store?.appendEvent?.(task.taskId, event);
    return this.store?.save?.(task);
  }
  get(taskId) {
    const local = this.tasks.get(taskId); if (local) return local;
    const persisted = this.store?.get?.(taskId) || null;
    if (persisted) this.tasks.set(taskId, persisted);
    return persisted;
  }
  list(statusFilter = null, scope = {}) {
    const local = [...this.tasks.values()].filter((task) => (!statusFilter || task.status === statusFilter) && scopeMatches(task, scope));
    const persisted = this.store?.list?.({ status: statusFilter, scope }) || [];
    const merged = new Map([...persisted, ...local].map((task) => [task.taskId, task]));
    return [...merged.values()].filter((task) => (!statusFilter || task.status === statusFilter) && scopeMatches(task, scope));
  }
  listForUser(userId, scope = {}) { return this.list(null, { ...scope, userId }); }
  hydrate(tasks = []) { for (const task of tasks) if (task?.taskId) { if (!Array.isArray(task.events)) task.events = []; this.tasks.set(task.taskId, task); if (task.idempotencyKey) this.idempotencyKeys.set(task.idempotencyKey, task.taskId); } this.counter = this.tasks.size; return this.tasks.size; }

  findByIdempotencyKey(idempotencyKey, scope = {}) {
    if (!idempotencyKey || !this.idempotencyKeys.has(idempotencyKey)) return null;
    const task = this.get(this.idempotencyKeys.get(idempotencyKey));
    return task && scopeMatches(task, scope) ? task : null;
  }

  /** Mark in-flight work as interrupted after a process restart; never replay side effects automatically. */
  recoverInterrupted() {
    const interrupted = this.list(TaskStatus.RUNNING);
    for (const task of interrupted) {
      this.setStatus(task.taskId, TaskStatus.FAILED, 'Process restarted while task was running; automatic replay is disabled pending verification');
      task.recovery = { state: 'interrupted', recoveredAt: this.clock(), replayed: false };
      task.updatedAt = this.clock();
      this._persist(task);
    }
    return interrupted.length;
  }

  updateWbs(taskId, stepId, patch = {}) { const task = this.get(taskId); if (!task) return null; task.wbs = updateActionWbs(task.wbs, stepId, patch); task.wbsSummary = summarizeActionWbs(task.wbs); task.nextActionProposal = createNextActionProposal({ task, context: task.planningContext || task.scope, now: this.clock() }); task.updatedAt = this.clock(); this._persist(task); this.emit('task:wbs-updated', task); return task; }
  completeWbsStep(taskId, stepId, result = null) { return this.updateWbs(taskId, stepId, { status: 'completed', result }); }
  update(taskId, patch) { const task = this.get(taskId); if (!task) return null; Object.assign(task, patch, { updatedAt: this.clock() }); this._persist(task); this.emit('task:updated', task); return task; }
  appendOutput(taskId, role, content) { const task = this.get(taskId); if (!task) return null; task.messages.push({ role, content, timestamp: this.clock() }); task.output += `${content}\n`; task.updatedAt = this.clock(); this._persist(task); return task; }

  setStatus(taskId, status, reason = null) {
    if (!Object.values(TaskStatus).includes(status)) throw new Error(`Invalid task status: ${status}`);
    const task = this.get(taskId); if (!task) return null; task.status = status; task.updatedAt = this.clock();
    if (reason) task.messages.push({ role: 'system', content: `Status → ${status}: ${reason}`, timestamp: this.clock() });
    this._persist(task, 'task.status-changed', { status }); this.emit(`task:${status}`, task); return task;
  }

  setPhase(taskId, phase, { approvalId = null } = {}) {
    const task = this.get(taskId); if (!task) return null;
    const allowed = { plan: ['draft'], draft: ['approve', 'execute'], approve: ['execute'], execute: ['observe'], observe: ['verify'], verify: ['complete'], complete: [] };
    if (!allowed[task.execution.phase]?.includes(phase)) {
      if (phase === TaskPhase.EXECUTE) {
        throw new Error(task.execution.approvalRequired
          ? 'Execution requires completed plan and draft, followed by approval'
          : 'Execution requires completed plan and draft');
      }
      throw new Error(`Invalid task phase transition ${task.execution.phase} -> ${phase}`);
    }
    if (phase === TaskPhase.EXECUTE) {
      if (!task.execution.planReady || !task.execution.draftReady) throw new Error('Execution requires completed plan and draft');
      if (task.execution.approvalRequired && !task.execution.approved) throw new Error('Execution approval required');
      task.execution.executionStartedAt = this.clock(); task.status = TaskStatus.RUNNING;
    }
    if (phase === TaskPhase.APPROVE && !task.execution.approvalRequired) throw new Error('Approval phase is not required for this task');
    task.execution.phase = phase; if (approvalId) task.execution.approvalId = approvalId; task.updatedAt = this.clock(); this._persist(task); this.emit('task:phase', task); return task;
  }

  markPlanReady(taskId, plan = {}) { const task = this.get(taskId); if (!task) return null; task.plan = plan; task.execution.planReady = true; task.execution.phase = TaskPhase.DRAFT; task.updatedAt = this.clock(); this._persist(task); this.emit('task:planned', task); return task; }
  markDraftReady(taskId, draft = {}) { const task = this.get(taskId); if (!task) return null; if (!task.execution.planReady) throw new Error('Draft requires a completed plan'); task.draft = draft; task.execution.draftReady = true; task.execution.phase = task.execution.approvalRequired ? TaskPhase.APPROVE : TaskPhase.DRAFT; task.updatedAt = this.clock(); this._persist(task); this.emit('task:drafted', task); return task; }
  approveExecution(taskId, approvalId = null) { const task = this.get(taskId); if (!task) return null; if (!task.execution.planReady || !task.execution.draftReady) throw new Error('Approval requires completed plan and draft'); task.execution.approved = true; task.execution.approvalId = approvalId; task.execution.phase = TaskPhase.APPROVE; task.updatedAt = this.clock(); this._persist(task); this.emit('task:approved', task); return task; }
  beginExecution(taskId) { return this.setPhase(taskId, TaskPhase.EXECUTE); }
  checkpoint(taskId, checkpoint = {}) { const task = this.get(taskId); if (!task) return null; task.checkpoints.push({ ...checkpoint, timestamp: this.clock() }); task.updatedAt = this.clock(); this._persist(task); this.emit('task:checkpoint', task); return task; }
  markVerified(taskId, evidence = []) { const task = this.get(taskId); if (!task) return null; if (task.execution.phase !== TaskPhase.OBSERVE && task.execution.phase !== TaskPhase.EXECUTE) throw new Error('Verification requires execution/observation'); task.execution.verifiedAt = this.clock(); task.execution.verificationEvidence = [...evidence]; task.execution.phase = TaskPhase.VERIFY; task.updatedAt = this.clock(); this._persist(task); this.emit('task:verified', task); return task; }
  findIncomplete({ scope = {}, staleAfterMs = this.staleAfterMs } = {}) { const now = this.clock(); return this.list(null, scope).filter((task) => !TERMINAL_STATUSES.has(task.status)).map((task) => ({ ...task, stale: now - task.updatedAt > staleAfterMs })); }
  summary() { const counts = {}; for (const status of Object.values(TaskStatus)) counts[status] = 0; for (const task of this.list()) counts[task.status] = (counts[task.status] || 0) + 1; return { total: this.list().length, ...counts, incomplete: this.findIncomplete().length }; }
  stop(taskId) { return this.setStatus(taskId, TaskStatus.STOPPED, 'Stopped by operator'); }
  assignTeam(taskId, teamId) { return this.update(taskId, { teamId }); }
}

let _instance = null;
function getTaskRegistry(options) {
  if (!_instance) {
    const explicitStore = options && Object.prototype.hasOwnProperty.call(options, 'store');
    const store = explicitStore ? options.store : new FileTaskStore({ directory: path.join(STATE_PATH, 'tasks') });
    _instance = new TaskRegistry({ ...options, store });
    _instance.recoverInterrupted();
  }
  return _instance;
}
export { TaskRegistry, TaskStatus, TaskPhase, TERMINAL_STATUSES, getTaskRegistry };
