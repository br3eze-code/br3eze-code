import { createHash, randomUUID } from 'node:crypto';

export const LOOP_STATES = Object.freeze({ RECEIVED: 'RECEIVED', PLANNING: 'PLANNING', EXECUTING: 'EXECUTING', OBSERVING: 'OBSERVING', EVALUATING: 'EVALUATING', WAIT: 'WAIT', COMPLETE: 'COMPLETE', RETRY: 'RETRY', HANDOFF: 'HANDOFF', ESCALATE: 'ESCALATE', FAILED: 'FAILED' });
export const DEFAULT_LOOP_LIMITS = Object.freeze({ maxIterations: 8, maxToolCalls: 25, timeoutMs: 120000, maxHandoffs: 5, maxRetries: 2, maxCost: 50 });
const TRANSITIONS = Object.freeze({ RECEIVED: ['PLANNING'], PLANNING: ['EXECUTING', 'WAIT', 'HANDOFF', 'ESCALATE', 'FAILED'], EXECUTING: ['OBSERVING', 'FAILED'], OBSERVING: ['EVALUATING', 'FAILED'], EVALUATING: ['COMPLETE', 'RETRY', 'WAIT', 'HANDOFF', 'ESCALATE', 'FAILED'], WAIT: ['PLANNING', 'ESCALATE', 'FAILED'], RETRY: ['PLANNING', 'ESCALATE', 'FAILED'], HANDOFF: ['PLANNING', 'ESCALATE', 'FAILED'], ESCALATE: ['FAILED', 'HANDOFF'], COMPLETE: [], FAILED: [] });
const RETRYABLE = new Set(['NETWORK_TIMEOUT', 'RATE_LIMIT', 'TEMPORARY_PROVIDER_FAILURE', 'STALE_READ', 'TOOL_TIMEOUT', 'SPECIALIST_UNAVAILABLE']);
const PERMISSION = new Set(['NOT_AUTHORIZED', 'PERMISSION_DENIED', 'APPROVAL_REQUIRED']);
const BUSINESS = new Set(['INSUFFICIENT_STOCK', 'INVALID_ORDER', 'PAYMENT_DECLINED', 'VALIDATION_ERROR']);

export function classifyFailure(error) {
  const code = error?.code || error?.error?.code || 'UNKNOWN_ERROR';
  if (RETRYABLE.has(code)) return 'retryable';
  if (PERMISSION.has(code)) return 'permission';
  if (BUSINESS.has(code)) return 'business';
  return 'unknown';
}

function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { const error = new Error('Action timed out'); error.code = 'TOOL_TIMEOUT'; reject(error); }, ms); });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
}

export class LoopEngine {
  constructor({ limits = {}, idFactory = () => `loop_${randomUUID()}`, clock = () => Date.now(), onHandoff = null, onEscalate = null, verifier = null } = {}) { this.limits = { ...DEFAULT_LOOP_LIMITS, ...limits }; this.idFactory = idFactory; this.clock = clock; this.onHandoff = onHandoff; this.onEscalate = onEscalate; this.verifier = verifier; }

  createState({ workId, goal, specialist = null, acceptanceCriteria = [], tenantId, projectId = null, taskId = null }) {
    if (!workId || !goal || !tenantId) throw new TypeError('workId, goal, and tenantId are required');
    const work = Object.freeze({ workId, taskId, tenantId, projectId, goal, acceptanceCriteria: Object.freeze([...acceptanceCriteria]) });
    const state = { loopId: this.idFactory(), work, acceptanceCriteria: work.acceptanceCriteria, specialist, state: LOOP_STATES.RECEIVED, status: 'running', iteration: 0, toolCalls: 0, cost: 0, retries: 0, handoffCount: 0, observations: [], actions: [], decisions: [], blockers: [], evidence: [], trace: [], startedAt: this.clock() };
    this.#transition(state, LOOP_STATES.PLANNING, 'loop.created');
    return state;
  }

  async run({ state, plan, execute, verify = this.verifier }) {
    const loop = state;
    const started = loop.startedAt;
    try {
      while (![LOOP_STATES.COMPLETE, LOOP_STATES.FAILED].includes(loop.state)) {
        if (this.clock() - started >= this.limits.timeoutMs || loop.iteration >= this.limits.maxIterations || loop.toolCalls >= this.limits.maxToolCalls || loop.cost >= this.limits.maxCost) return this.#finish(loop, loop.cost >= this.limits.maxCost ? 'COST_LIMIT' : 'LOOP_LIMIT', 'loop limit reached');
        if (loop.state === LOOP_STATES.RETRY || loop.state === LOOP_STATES.HANDOFF) this.#transition(loop, LOOP_STATES.PLANNING, loop.state === LOOP_STATES.RETRY ? 'retry.planning' : 'handoff.resumed');
        if (loop.state === LOOP_STATES.PLANNING) {
          loop.iteration += 1;
          const action = await plan(Object.freeze({ ...loop, work: loop.work, acceptanceCriteria: loop.work.acceptanceCriteria }));
          if (!action?.tool && !['handoff', 'wait'].includes(action?.type)) return this.#finish(loop, 'UNKNOWN_ERROR', 'plan did not produce an action');
          loop.actions.push(Object.freeze({ actionId: `act_${loop.iteration}_${loop.toolCalls}`, ...action, inputHash: hash(action.input || {}) }));
          if (action.type === 'wait') { loop.waitUntil = action.until || null; loop.waitReason = action.reason || null; this.#transition(loop, LOOP_STATES.WAIT, 'loop.waiting'); loop.status = 'waiting'; return loop; }
          if (action.type === 'handoff') { if (loop.handoffCount >= this.limits.maxHandoffs) return this.#finish(loop, 'LOOP_LIMIT', 'handoff limit reached'); this.#transition(loop, LOOP_STATES.HANDOFF, 'handoff.created'); loop.handoffCount += 1; const handoff = await this.onHandoff?.(action.handoff, loop); if (handoff?.status === 'failed') return this.#finish(loop, 'HANDOFF_FAILED', 'handoff delivery failed'); loop.specialist = handoff?.to || action.handoff?.to || loop.specialist; continue; }
          this.#transition(loop, LOOP_STATES.EXECUTING, 'action.requested');
          if (loop.toolCalls >= this.limits.maxToolCalls) return this.#finish(loop, 'LOOP_LIMIT', 'tool-call limit reached');
          loop.toolCalls += 1;
          const result = await withTimeout(Promise.resolve().then(() => execute(action.tool, action.input, loop)), Math.max(1, this.limits.timeoutMs - (this.clock() - started)));
          loop.cost += Number(result?.cost || result?.usage?.cost || 0);
          if (loop.cost > this.limits.maxCost) return this.#finish(loop, 'COST_LIMIT', 'execution cost budget exceeded');
          this.#transition(loop, LOOP_STATES.OBSERVING, 'tool.executed');
          loop.observations.push(result); loop.evidence.push(...(result?.evidence || [])); this.#transition(loop, LOOP_STATES.EVALUATING, 'observation.recorded');
          if (result?.success === false) { const kind = classifyFailure(result); loop.blockers.push({ code: result.error?.code, class: kind }); if (kind === 'retryable' && loop.retries < Math.min(this.limits.maxRetries, action.maxRetries ?? this.limits.maxRetries)) { loop.retries += 1; this.#transition(loop, LOOP_STATES.RETRY, 'evaluation.retry'); continue; } if (kind === 'permission' && this.onHandoff) { this.#transition(loop, LOOP_STATES.HANDOFF, 'approval.handoff'); loop.handoffCount += 1; const handoff = await this.onHandoff({ workId: loop.work.workId, loopId: loop.loopId, parentExecutionId: result.executionId || null, tenantId: loop.work.tenantId, projectId: loop.work.projectId, from: loop.specialist, to: 'project-manager', requestedAction: 'approval.escalate', acceptanceCriteria: loop.work.acceptanceCriteria, evidence: result.evidence || [], openRisks: [result.error?.code] }, loop); if (handoff?.status === 'failed') return this.#finish(loop, 'HANDOFF_FAILED', 'approval handoff failed'); return { ...loop, status: 'handoff' }; } return this.#finish(loop, result.error?.code || 'ACTION_FAILED', kind); }
          const verification = await verify(result, Object.freeze({ ...loop, work: loop.work, acceptanceCriteria: loop.work.acceptanceCriteria }));
          loop.decisions.push(verification); loop.trace.push({ event: 'verification.completed', loopId: loop.loopId, accepted: verification?.accepted === true });
          if (verification?.accepted === true) { loop.state = LOOP_STATES.COMPLETE; loop.status = 'completed'; loop.completedAt = this.clock(); loop.trace.push({ event: 'loop.completed', loopId: loop.loopId }); return loop; }
          if (verification?.retryable === true) { this.#transition(loop, LOOP_STATES.RETRY, 'evaluation.verification_retry'); continue; }
          return this.#finish(loop, 'ACCEPTANCE_FAILED', verification?.reason || 'acceptance criteria not met');
        }
      }
      return loop;
    } catch (error) { return this.#finish(loop, error.code || 'UNKNOWN_ERROR', error.message); }
  }

  resume(state) {
    if (state?.state !== LOOP_STATES.WAIT) throw new Error('Only waiting loops can be resumed');
    this.#transition(state, LOOP_STATES.PLANNING, 'loop.resumed');
    state.status = 'running';
    return state;
  }

  #transition(loop, next, event) { if (!TRANSITIONS[loop.state]?.includes(next)) throw new Error(`Invalid loop transition ${loop.state} -> ${next}`); loop.state = next; loop.trace.push({ event, loopId: loop.loopId, state: next, iteration: loop.iteration, timestamp: this.clock() }); }
  #finish(loop, code, reason) { if (loop.state !== LOOP_STATES.FAILED) { if (loop.state !== LOOP_STATES.EVALUATING && loop.state !== LOOP_STATES.OBSERVING && loop.state !== LOOP_STATES.EXECUTING && loop.state !== LOOP_STATES.PLANNING) loop.state = LOOP_STATES.EVALUATING; loop.blockers.push({ code, reason }); loop.trace.push({ event: 'loop.failed', loopId: loop.loopId, code, reason }); loop.state = LOOP_STATES.FAILED; loop.status = code === 'LOOP_LIMIT' ? 'loop_limit' : 'failed'; loop.completedAt = this.clock(); this.onEscalate?.(loop); } return loop; }
}
