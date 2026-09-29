import crypto from 'node:crypto';

export const WorkStatus = Object.freeze({
  PENDING: 'pending',
  READY: 'ready',
  RUNNING: 'running',
  BLOCKED: 'blocked',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

const TERMINAL = new Set([WorkStatus.COMPLETED, WorkStatus.FAILED, WorkStatus.CANCELLED]);

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export class WorkGraph {
  constructor({ id: graphId = id('work'), goal, metadata = {} } = {}) {
    if (!goal || !String(goal).trim()) throw new TypeError('WorkGraph requires a goal');
    this.id = graphId;
    this.goal = String(goal);
    this.metadata = clone(metadata);
    this.nodes = new Map();
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
  }

  addTask({ id: taskId = id('task'), title, description = '', dependsOn = [], owner = null, capabilities = [], verification = [] } = {}) {
    if (!title || !String(title).trim()) throw new TypeError('WorkGraph task requires a title');
    if (this.nodes.has(taskId)) throw new Error(`Work task already exists: ${taskId}`);
    for (const dependency of dependsOn) {
      if (!this.nodes.has(dependency)) throw new Error(`Unknown dependency: ${dependency}`);
    }
    const task = {
      id: taskId,
      type: 'task',
      title: String(title),
      description: String(description),
      dependsOn: [...new Set(dependsOn)],
      owner,
      capabilities: [...new Set(capabilities)],
      verification: clone(verification),
      status: dependsOn.length ? WorkStatus.PENDING : WorkStatus.READY,
      result: null,
      evidence: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.nodes.set(taskId, task);
    this.#assertAcyclic();
    this.#refreshReady();
    return clone(task);
  }

  addDependency(taskId, dependencyId) {
    const task = this.nodes.get(taskId);
    if (!task) throw new Error(`Unknown work task: ${taskId}`);
    if (!this.nodes.has(dependencyId)) throw new Error(`Unknown dependency: ${dependencyId}`);
    if (taskId === dependencyId) throw new Error('WorkGraph dependency cycle detected');
    const previous = [...task.dependsOn];
    task.dependsOn = [...new Set([...task.dependsOn, dependencyId])];
    try {
      this.#assertAcyclic();
    } catch (error) {
      task.dependsOn = previous;
      throw error;
    }
    this.#refreshReady();
    task.updatedAt = new Date().toISOString();
    this.updatedAt = task.updatedAt;
    return clone(task);
  }

  get(taskId) { return clone(this.nodes.get(taskId) || null); }

  list({ status = null } = {}) {
    return [...this.nodes.values()]
      .filter((task) => !status || task.status === status)
      .map(clone);
  }

  ready() {
    this.#refreshReady();
    return this.list({ status: WorkStatus.READY });
  }

  transition(taskId, status, { result = null, reason = null } = {}) {
    const task = this.nodes.get(taskId);
    if (!task) throw new Error(`Unknown work task: ${taskId}`);
    if (TERMINAL.has(task.status) && task.status !== status) {
      throw new Error(`Cannot transition terminal task ${taskId} from ${task.status} to ${status}`);
    }
    const allowed = {
      [WorkStatus.PENDING]: new Set([WorkStatus.READY, WorkStatus.BLOCKED, WorkStatus.CANCELLED]),
      [WorkStatus.READY]: new Set([WorkStatus.RUNNING, WorkStatus.BLOCKED, WorkStatus.CANCELLED]),
      [WorkStatus.RUNNING]: new Set([WorkStatus.COMPLETED, WorkStatus.FAILED, WorkStatus.BLOCKED, WorkStatus.CANCELLED]),
      [WorkStatus.BLOCKED]: new Set([WorkStatus.READY, WorkStatus.CANCELLED]),
      [WorkStatus.COMPLETED]: new Set(),
      [WorkStatus.FAILED]: new Set(),
      [WorkStatus.CANCELLED]: new Set(),
    };
    if (task.status !== status && !allowed[task.status]?.has(status)) {
      throw new Error(`Invalid work transition: ${task.status} -> ${status}`);
    }
    task.status = status;
    if (result !== null) task.result = clone(result);
    if (reason) task.blockReason = String(reason);
    task.updatedAt = new Date().toISOString();
    this.updatedAt = task.updatedAt;
    this.#refreshReady();
    return clone(task);
  }

  attachEvidence(taskId, evidence) {
    const task = this.nodes.get(taskId);
    if (!task) throw new Error(`Unknown work task: ${taskId}`);
    if (!evidence || typeof evidence !== 'object') throw new TypeError('Evidence must be an object');
    task.evidence.push({ ...clone(evidence), recordedAt: new Date().toISOString() });
    task.updatedAt = new Date().toISOString();
    this.updatedAt = task.updatedAt;
    return clone(task);
  }

  summary() {
    const counts = Object.fromEntries(Object.values(WorkStatus).map((status) => [status, 0]));
    for (const task of this.nodes.values()) counts[task.status] += 1;
    return { id: this.id, goal: this.goal, total: this.nodes.size, ...counts };
  }

  toJSON() {
    return {
      id: this.id,
      goal: this.goal,
      metadata: clone(this.metadata),
      tasks: this.list(),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  #refreshReady() {
    for (const task of this.nodes.values()) {
      if (TERMINAL.has(task.status) || task.status === WorkStatus.RUNNING) continue;
      const dependencies = task.dependsOn.map((dependency) => this.nodes.get(dependency));
      const failedDependency = dependencies.find((dependency) =>
        dependency && [WorkStatus.FAILED, WorkStatus.CANCELLED].includes(dependency.status)
      );
      if (failedDependency) {
        task.status = WorkStatus.BLOCKED;
        task.blockReason = `Dependency ${failedDependency.id} is ${failedDependency.status}`;
      } else if (dependencies.every((dependency) => dependency?.status === WorkStatus.COMPLETED)) {
        task.status = WorkStatus.READY;
        delete task.blockReason;
      } else if (task.status === WorkStatus.READY) {
        task.status = WorkStatus.PENDING;
      }
    }
  }

  #assertAcyclic() {
    const visiting = new Set();
    const visited = new Set();
    const visit = (taskId) => {
      if (visiting.has(taskId)) throw new Error('WorkGraph dependency cycle detected');
      if (visited.has(taskId)) return;
      visiting.add(taskId);
      for (const dependency of this.nodes.get(taskId).dependsOn) visit(dependency);
      visiting.delete(taskId);
      visited.add(taskId);
    };
    for (const taskId of this.nodes.keys()) visit(taskId);
  }
}
