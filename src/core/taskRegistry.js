import { v4 as uuidv4 } from 'uuid';
import EventEmitter from 'events';
import { createActionWbs, updateActionWbs, completeActionWbsStep, summarizeActionWbs } from './action-wbs.js';
import { createNextActionProposal } from './next-action-planner.js';

const TaskStatus = Object.freeze({ CREATED: 'created', RUNNING: 'running', COMPLETED: 'completed', FAILED: 'failed', STOPPED: 'stopped' });
const TaskPhase = Object.freeze({ PLAN: 'plan', DRAFT: 'draft', APPROVE: 'approve', EXECUTE: 'execute', OBSERVE: 'observe', VERIFY: 'verify', COMPLETE: 'complete' });
const TERMINAL_STATUSES = new Set([TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.STOPPED]);
const MUTATING_ACTION_PATTERNS = Object.freeze([/^payment\./, /^purchase\./, /^supplier\.commit$/, /^budget\.allocate$/, /^ledger\.write$/, /^settlement\./, /^order\.(create|commit|cancel)/, /^account\.(suspend|delete)/]);
const requiresApprovalByAction = (action) => MUTATING_ACTION_PATTERNS.some((pattern) => pattern.test(String(action || '')));

class TaskRegistry extends EventEmitter {
  constructor({ store = null, staleAfterMs = 30 * 60 * 1000, clock = () => Date.now() } = {}) {
    super(); this.tasks = new Map(); this.counter = 0; this.store = store; this.staleAfterMs = staleAfterMs; this.clock = clock;
  }

  create(prompt, { description = null, teamId = null, action = null, owner = null, context = {}, wbs = null, input = {}, requiresExecutionApproval = requiresApprovalByAction(action) } = {}) {
    const taskId = uuidv4(), now = this.clock();
    const taskWbs = wbs || createActionWbs(action || 'assist.task', { context, input: { text: prompt, action, ...input } });
    const task = {
      taskId, prompt, description, status: TaskStatus.CREATED, createdAt: now, updatedAt: now, messages: [], output: '', teamId, action,
      owner: owner ? { userId: owner.userId || null, platformId: owner.platformId || null } : null,
      scope: { tenantId: context.tenantId || null, domainId: context.domainId || null, siteId: context.siteId || null, userId: context.userId || owner?.userId || null, channel: context.channel || null },
      wbs: taskWbs, wbsSummary: summarizeActionWbs(taskWbs),
      planningContext: { tenantId: context.tenantId || null, domainId: context.domainId || null, siteId: context.siteId || null, userId: context.userId || owner?.userId || null, channel: context.channel || null, role: context.role || null, status: context.status || context.userDoc?.status || null, authorizedCapabilities: Array.isArray(context.authorizedCapabilities || context.capabilities) ? [...(context.authorizedCapabilities || context.capabilities)] : [], locationPermission: context.locationPermission === true, proactiveOptOut: context.proactiveOptOut === true, timeZone: context.timeZone || null },
      execution: { phase: TaskPhase.PLAN, planReady: false, draftReady: false, approvalRequired: Boolean(requiresExecutionApproval), approved: false, approvalId: null, executionStartedAt: null, verifiedAt: null },
      checkpoints: [], nextActionProposal: null
    };
    task.nextActionProposal = createNextActionProposal({ task, context, now }); this.tasks.set(taskId, task); this.counter++; this._persist(task); this.emit('task:created', task); return task;
  }

  _persist(task) { this.store?.save?.(task); }
  get(taskId) { return this.tasks.get(taskId) || this.store?.get?.(taskId) || null; }
  list(statusFilter = null, scope = {}) { return [...this.tasks.values()].filter((task) => (!statusFilter || task.status === statusFilter) && ['tenantId', 'domainId', 'siteId', 'userId'].every((key) => !scope[key] || task.scope?.[key] === scope[key])); }
  listForUser(userId, scope = {}) { return this.list(null, { ...scope, userId }); }

  updateWbs(taskId, stepId, patch = {}) { const task = this.tasks.get(taskId); if (!task) return null; task.wbs = updateActionWbs(task.wbs, stepId, patch); task.wbsSummary = summarizeActionWbs(task.wbs); task.nextActionProposal = createNextActionProposal({ task, context: task.planningContext || task.scope, now: this.clock() }); task.updatedAt = this.clock(); this._persist(task); this.emit('task:wbs-updated', task); return task; }
  completeWbsStep(taskId, stepId, result = null) { return this.updateWbs(taskId, stepId, { status: 'completed', result }); }
  update(taskId, patch) { const task = this.tasks.get(taskId); if (!task) return null; Object.assign(task, patch, { updatedAt: this.clock() }); this._persist(task); this.emit('task:updated', task); return task; }
  appendOutput(taskId, role, content) { const task = this.tasks.get(taskId); if (!task) return null; task.messages.push({ role, content, timestamp: this.clock() }); task.output += `${content}\n`; task.updatedAt = this.clock(); this._persist(task); return task; }

  setStatus(taskId, status, reason = null) {
    if (!Object.values(TaskStatus).includes(status)) throw new Error(`Invalid task status: ${status}`);
    const task = this.tasks.get(taskId); if (!task) return null; task.status = status; task.updatedAt = this.clock();
    if (reason) task.messages.push({ role: 'system', content: `Status → ${status}: ${reason}`, timestamp: this.clock() });
    this._persist(task); this.emit(`task:${status}`, task); return task;
  }

  setPhase(taskId, phase, { approvalId = null } = {}) {
    const task = this.tasks.get(taskId); if (!task) return null;
    const allowed = { plan: ['draft'], draft: ['approve', 'execute'], approve: ['execute'], execute: ['observe'], observe: ['verify'], verify: ['complete'], complete: [] };
    const current = task.execution.phase;
    if (!allowed[current]?.includes(phase)) throw new Error(`Invalid task phase transition ${current} -> ${phase}`);
    if (phase === TaskPhase.EXECUTE) {
      if (!task.execution.planReady || !task.execution.draftReady) throw new Error('Execution requires completed plan and draft');
      if (task.execution.approvalRequired && !task.execution.approved) throw new Error('Execution approval required');
      task.execution.executionStartedAt = this.clock(); task.status = TaskStatus.RUNNING;
    }
    if (phase === TaskPhase.APPROVE && !task.execution.approvalRequired) throw new Error('Approval phase is not required for this task');
    task.execution.phase = phase; if (approvalId) task.execution.approvalId = approvalId; task.updatedAt = this.clock(); this._persist(task); this.emit('task:phase', task); return task;
  }

  markPlanReady(taskId, plan = {}) { const task = this.tasks.get(taskId); if (!task) return null; task.plan = plan; task.execution.planReady = true; task.execution.phase = TaskPhase.DRAFT; task.updatedAt = this.clock(); this._persist(task); this.emit('task:planned', task); return task; }
  markDraftReady(taskId, draft = {}) { const task = this.tasks.get(taskId); if (!task) return null; if (!task.execution.planReady) throw new Error('Draft requires a completed plan'); task.draft = draft; task.execution.draftReady = true; task.execution.phase = task.execution.approvalRequired ? TaskPhase.APPROVE : TaskPhase.DRAFT; task.updatedAt = this.clock(); this._persist(task); this.emit('task:drafted', task); return task; }
  approveExecution(taskId, approvalId = null) { const task = this.tasks.get(taskId); if (!task) return null; if (!task.execution.planReady || !task.execution.draftReady) throw new Error('Approval requires completed plan and draft'); task.execution.approved = true; task.execution.approvalId = approvalId; task.execution.phase = TaskPhase.APPROVE; task.updatedAt = this.clock(); this._persist(task); this.emit('task:approved', task); return task; }
  beginExecution(taskId) { return this.setPhase(taskId, TaskPhase.EXECUTE); }
  checkpoint(taskId, checkpoint = {}) { const task = this.tasks.get(taskId); if (!task) return null; task.checkpoints.push({ ...checkpoint, timestamp: this.clock() }); task.updatedAt = this.clock(); this._persist(task); this.emit('task:checkpoint', task); return task; }
  markVerified(taskId, evidence = []) { const task = this.tasks.get(taskId); if (!task) return null; task.execution.verifiedAt = this.clock(); task.execution.verificationEvidence = [...evidence]; task.execution.phase = TaskPhase.VERIFY; task.updatedAt = this.clock(); this._persist(task); this.emit('task:verified', task); return task; }

  findIncomplete({ scope = {}, staleAfterMs = this.staleAfterMs } = {}) { const now = this.clock(); return this.list(null, scope).filter((task) => !TERMINAL_STATUSES.has(task.status)).map((task) => ({ ...task, stale: now - task.updatedAt > staleAfterMs })); }
  summary() { const counts = {}; for (const status of Object.values(TaskStatus)) counts[status] = 0; for (const task of this.tasks.values()) counts[task.status] = (counts[task.status] || 0) + 1; return { total: this.tasks.size, ...counts, incomplete: this.findIncomplete().length }; }
  stop(taskId) { return this.setStatus(taskId, TaskStatus.STOPPED, 'Stopped by operator'); }
  assignTeam(taskId, teamId) { return this.update(taskId, { teamId }); }
}

let _instance = null;
function getTaskRegistry(options) { if (!_instance) _instance = new TaskRegistry(options); return _instance; }

export { TaskRegistry, TaskStatus, TaskPhase, TERMINAL_STATUSES, requiresApprovalByAction, getTaskRegistry };
