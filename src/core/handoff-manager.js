import { randomUUID } from 'node:crypto';

const HANDOFF_STATUSES = new Set(['proposed', 'acknowledged', 'accepted', 'rejected', 'returned', 'completed']);

function requireScope(value, name) {
  if (!value || typeof value !== 'string') throw new TypeError(`handoff.${name} is required`);
  return value;
}

function validateHandoff(input) {
  const handoff = {
    handoffId: input.handoffId || `handoff_${randomUUID()}`,
    workId: requireScope(input.workId, 'workId'),
    loopId: requireScope(input.loopId, 'loopId'),
    parentExecutionId: requireScope(input.parentExecutionId, 'parentExecutionId'),
    tenantId: requireScope(input.tenantId, 'tenantId'),
    projectId: input.projectId || null,
    siteId: input.siteId || null,
    from: requireScope(input.from, 'from'),
    to: requireScope(input.to, 'to'),
    requestedAction: requireScope(input.requestedAction, 'requestedAction'),
    acceptanceCriteria: Array.isArray(input.acceptanceCriteria) ? [...input.acceptanceCriteria] : [],
    evidence: Array.isArray(input.evidence) ? [...input.evidence] : [],
    openRisks: Array.isArray(input.openRisks) ? [...input.openRisks] : [],
    deadline: input.deadline || null,
    status: input.status || 'proposed',
    createdAt: input.createdAt || new Date().toISOString(),
  };
  if (!HANDOFF_STATUSES.has(handoff.status)) throw new TypeError(`Invalid handoff status: ${handoff.status}`);
  return Object.freeze(handoff);
}

export class HandoffManager {
  constructor({ idFactory = () => `handoff_${randomUUID()}` } = {}) {
    this.idFactory = idFactory;
    this.handoffs = new Map();
  }

  create(input) {
    const handoff = validateHandoff({ ...input, handoffId: input.handoffId || this.idFactory() });
    this.handoffs.set(handoff.handoffId, handoff);
    return handoff;
  }

  get(handoffId) {
    return this.handoffs.get(handoffId) || null;
  }

  transition(handoffId, status, actor, details = {}) {
    const current = this.handoffs.get(handoffId);
    if (!current) throw new Error(`Unknown handoff: ${handoffId}`);
    if (!HANDOFF_STATUSES.has(status)) throw new TypeError(`Invalid handoff status: ${status}`);
    const next = Object.freeze({
      ...current,
      ...details,
      status,
      lastAction: { status, actor, at: new Date().toISOString() },
    });
    this.handoffs.set(handoffId, next);
    return next;
  }

  acknowledge(handoffId, actor) {
    return this.transition(handoffId, 'acknowledged', actor);
  }

  accept(handoffId, actor, details = {}) {
    return this.transition(handoffId, 'accepted', actor, details);
  }

  reject(handoffId, actor, reason) {
    return this.transition(handoffId, 'rejected', actor, { rejectionReason: reason });
  }

  returnToSource(handoffId, actor, details = {}) {
    return this.transition(handoffId, 'returned', actor, details);
  }

  complete(handoffId, actor, evidence = []) {
    return this.transition(handoffId, 'completed', actor, { evidence: [...(this.get(handoffId)?.evidence || []), ...evidence] });
  }
}

export { HANDOFF_STATUSES, validateHandoff };
