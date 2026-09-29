import crypto from 'node:crypto';

export const ExecutionStatus = Object.freeze({
  CREATED: 'created',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

export class ExecutionRecord {
  constructor({ id = crypto.randomUUID(), taskId = null, agentId = null, planId = null, input = null, metadata = {} } = {}) {
    this.id = id;
    this.taskId = taskId;
    this.agentId = agentId;
    this.planId = planId;
    this.input = input;
    this.metadata = { ...metadata };
    this.status = ExecutionStatus.CREATED;
    this.events = [];
    this.evidence = [];
    this.artifacts = [];
    this.startedAt = null;
    this.completedAt = null;
  }

  start() {
    if (this.status !== ExecutionStatus.CREATED) throw new Error(`Execution ${this.id} cannot start from ${this.status}`);
    this.status = ExecutionStatus.RUNNING;
    this.startedAt = new Date().toISOString();
    this.event('execution.started');
    return this;
  }

  event(type, data = {}) {
    this.events.push({ id: crypto.randomUUID(), type, data, at: new Date().toISOString() });
    return this;
  }

  addEvidence(evidence) {
    if (!evidence || typeof evidence !== 'object') throw new TypeError('Evidence must be an object');
    this.evidence.push({ id: crypto.randomUUID(), ...evidence, at: new Date().toISOString() });
    return this;
  }

  addArtifact(artifact) {
    if (!artifact || typeof artifact !== 'object') throw new TypeError('Artifact must be an object');
    this.artifacts.push({ ...artifact, at: new Date().toISOString() });
    return this;
  }

  succeed(result = null) {
    return this.#finish(ExecutionStatus.SUCCEEDED, result);
  }

  fail(error) {
    return this.#finish(ExecutionStatus.FAILED, { error: error instanceof Error ? error.message : String(error) });
  }

  cancel(reason = 'cancelled') {
    return this.#finish(ExecutionStatus.CANCELLED, { reason });
  }

  #finish(status, result) {
    if (this.status !== ExecutionStatus.RUNNING) throw new Error(`Execution ${this.id} cannot finish from ${this.status}`);
    this.status = status;
    this.result = result;
    this.completedAt = new Date().toISOString();
    this.event(`execution.${status}`, result || {});
    return this;
  }

  toJSON() {
    return JSON.parse(JSON.stringify({
      id: this.id,
      taskId: this.taskId,
      agentId: this.agentId,
      planId: this.planId,
      input: this.input,
      metadata: this.metadata,
      status: this.status,
      events: this.events,
      evidence: this.evidence,
      artifacts: this.artifacts,
      result: this.result ?? null,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
    }));
  }
}
