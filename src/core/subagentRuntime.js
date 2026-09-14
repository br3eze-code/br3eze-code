import crypto from 'node:crypto';

const TERMINAL = new Set(['completed', 'failed', 'terminated']);

/**
 * Canonical subagent lifecycle manager.
 *
 * It owns lifecycle policy only. Execution is injected by the host/runtime,
 * and persistence is supplied through the SubagentStore port.
 */
export class SubagentRuntime {
  constructor({ store, executor = null, maxDepth = 3, defaultBudget = 100 } = {}) {
    if (!store) throw new TypeError('SubagentRuntime requires a SubagentStore');
    this.store = store;
    this.executor = executor;
    this.maxDepth = maxDepth;
    this.defaultBudget = defaultBudget;
  }

  spawn({ parentId = null, role, scope = {}, permissions = [], depth, budget, metadata = {} } = {}) {
    if (!role || typeof role !== 'string') throw new TypeError('subagent role is required');
    const parent = parentId ? this.store.get(parentId) : null;
    if (parentId && !parent) throw new Error(`Parent subagent not found: ${parentId}`);

    const resolvedDepth = depth ?? (parent ? parent.depth + 1 : 0);
    if (!Number.isInteger(resolvedDepth) || resolvedDepth < 0) throw new TypeError('subagent depth must be a non-negative integer');
    if (resolvedDepth > this.maxDepth) {
      const error = new Error(`Subagent spawn depth ${resolvedDepth} exceeds maximum ${this.maxDepth}`);
      error.code = 'SUBAGENT_DEPTH_EXCEEDED';
      throw error;
    }

    const now = Date.now();
    const item = {
      id: crypto.randomUUID(), parentId, role, scope, permissions,
      depth: resolvedDepth, budget: budget ?? this.defaultBudget, spent: 0,
      status: 'ready', createdAt: now, updatedAt: now, metadata,
    };
    if (!Number.isFinite(item.budget) || item.budget < 0) throw new TypeError('subagent budget must be a non-negative number');
    return this.store.create(item);
  }

  get(id) { return this.store.get(id); }

  async run(id, input, { cost = 1, executor = this.executor, ...context } = {}) {
    const item = this._require(id);
    if (TERMINAL.has(item.status)) throw new Error(`Subagent ${id} is ${item.status}`);
    if (!Number.isFinite(cost) || cost < 0) throw new TypeError('execution cost must be a non-negative number');
    if (item.spent + cost > item.budget) {
      const error = new Error(`Subagent budget exceeded: ${id}`);
      error.code = 'SUBAGENT_BUDGET_EXCEEDED';
      throw error;
    }
    if (typeof executor !== 'function') throw new Error('No subagent executor configured');

    this.store.update(id, { status: 'running', spent: item.spent + cost });
    try {
      const result = await executor({ subagent: this._require(id), input, context });
      this.store.update(id, { status: 'completed' });
      return result;
    } catch (error) {
      this.store.update(id, { status: 'failed', error: error.message });
      throw error;
    }
  }

  handoff(id, target, payload = {}) {
    const item = this._require(id);
    if (TERMINAL.has(item.status)) throw new Error(`Cannot handoff ${item.status} subagent`);
    if (!target || typeof target !== 'string') throw new TypeError('handoff target is required');
    return this.store.update(id, { status: 'handoff', handoff: { target, payload, at: Date.now() } });
  }

  terminate(id, reason = 'terminated') {
    const item = this._require(id);
    if (item.status === 'completed') throw new Error(`Cannot terminate completed subagent: ${id}`);
    return this.store.update(id, { status: 'terminated', terminationReason: reason });
  }

  _require(id) {
    const item = this.store.get(id);
    if (!item) throw new Error(`Subagent not found: ${id}`);
    return item;
  }
}

export default SubagentRuntime;
