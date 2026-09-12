import { randomUUID } from 'node:crypto';
import { createExecutionState, transitionExecution, ExecutionStatus } from './ExecutionState.js';
import { InMemoryCheckpointStore, assertCheckpointStore } from './CheckpointStore.js';

export const START = '__start__';
export const END = '__end__';

export class ExecutionGraph {
  constructor({ nodes = {}, edges = [], checkpointStore = new InMemoryCheckpointStore(), maxSteps = 100, onEvent = null, idempotencyStore = null } = {}) {
    this.nodes = new Map(Object.entries(nodes));
    this.edges = [...edges];
    this.store = assertCheckpointStore(checkpointStore);
    this.idempotencyStore = idempotencyStore;
    this.maxSteps = maxSteps;
    this.onEvent = onEvent;
  }
  addNode(id, handler) { if (!id || typeof handler !== 'function') throw new TypeError('node requires id and function'); this.nodes.set(id, handler); return this; }
  addEdge(from, to, condition = null) { if (!from || !to) throw new TypeError('edge requires from and to'); this.edges.push({ from, to, condition }); return this; }
  _next(nodeId, state) { const candidates = this.edges.filter(e => e.from === nodeId); const edge = candidates.find(e => !e.condition || e.condition(state) === true); return edge?.to || END; }
  _emit(event, state, extra = {}) { this.onEvent?.({ event, executionId: state.executionId, tenantId: state.tenantId, taskId: state.taskId, nodeId: state.nodeId, ...extra }); }
  async _load(id) { return this.store.load(id); }
  async _save(state) { return this.store.save(state); }
  async run(input, { tenantId, userId, taskId = null, context = {}, metadata = {}, executionId = randomUUID(), resume = true } = {}) {
    let state = resume ? await this._load(executionId) : null;
    if (!state) state = createExecutionState({ executionId, tenantId, userId, taskId, input, context, metadata });
    if (state.status === ExecutionStatus.COMPLETED) return state;
    if (state.status === ExecutionStatus.PAUSED || state.status === ExecutionStatus.WAITING) {
      state = transitionExecution(state, ExecutionStatus.RUNNING);
    } else {
      state = transitionExecution(state, ExecutionStatus.RUNNING, { nodeId: state.nodeId || START });
    }
    await this._save(state); this._emit('execution.started', state);
    try {
      let current = state.nextNode || (state.nodeId === START ? this._next(START, state) : state.nodeId);
      while (current !== END) {
        if (state.step >= this.maxSteps) throw new Error(`Execution exceeded maxSteps=${this.maxSteps}`);
        const handler = this.nodes.get(current); if (!handler) throw new Error(`Unknown execution node: ${current}`);
        state = transitionExecution(state, ExecutionStatus.RUNNING, { nodeId: current, nextNode: null });
        await this._save(state); this._emit('node.started', state);
        const idempotencyKey = `${state.executionId}:${current}:${state.metadata?.attempts?.[current] || 0}`;
        if (this.idempotencyStore?.has && await this.idempotencyStore.has(idempotencyKey)) {
          const cached = await this.idempotencyStore.get(idempotencyKey);
          state = transitionExecution(state, ExecutionStatus.RUNNING, { output: cached, nextNode: this._next(current, state) });
          await this._save(state); this._emit('node.replayed', state, { idempotencyKey });
        } else {
          const output = await handler({ state: structuredClone(state), input: state.input, context: state.context, executionId: state.executionId, idempotencyKey });
          const nextNode = this._next(current, { ...state, output });
          if (this.idempotencyStore?.set) await this.idempotencyStore.set(idempotencyKey, output);
          state = transitionExecution(state, ExecutionStatus.RUNNING, { output, nextNode, completedNode: current });
          await this._save(state); this._emit('node.completed', state, { nextNode, idempotencyKey });
        }
        current = state.nextNode || END;
      }
      state = transitionExecution(state, ExecutionStatus.COMPLETED, { nodeId: END, nextNode: null });
      await this._save(state); this._emit('execution.completed', state);
      return state;
    } catch (error) {
      state = transitionExecution(state, ExecutionStatus.FAILED, { error: { name: error.name, message: error.message }, nodeId: state.nodeId, nextNode: state.nextNode || state.nodeId });
      await this._save(state); this._emit('execution.failed', state, { error });
      throw error;
    }
  }
  async pause(executionId) { const state = await this._load(executionId); if (!state) throw new Error('Execution not found'); const next = transitionExecution(state, ExecutionStatus.PAUSED, { nextNode: state.nextNode || state.nodeId }); await this._save(next); this._emit('execution.paused', next); return next; }
  async resume(executionId, options = {}) { const state = await this._load(executionId); if (!state) throw new Error('Execution not found'); return this.run(state.input, { ...options, executionId, tenantId: state.tenantId, userId: state.userId, taskId: state.taskId, context: state.context, metadata: state.metadata, resume: true }); }
}
