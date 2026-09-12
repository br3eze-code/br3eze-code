import { randomUUID } from 'node:crypto';
import { createExecutionState, transitionExecution, ExecutionStatus } from './ExecutionState.js';
import { InMemoryCheckpointStore, assertCheckpointStore } from './CheckpointStore.js';

export const START = '__start__';
export const END = '__end__';

export class ExecutionGraph {
  constructor({ nodes = {}, edges = [], checkpointStore = new InMemoryCheckpointStore(), maxSteps = 100, onEvent = null } = {}) {
    this.nodes = new Map(Object.entries(nodes));
    this.edges = [...edges];
    this.store = assertCheckpointStore(checkpointStore);
    this.maxSteps = maxSteps;
    this.onEvent = onEvent;
  }
  addNode(id, handler) { if (!id || typeof handler !== 'function') throw new TypeError('node requires id and function'); this.nodes.set(id, handler); return this; }
  addEdge(from, to, condition = null) { if (!from || !to) throw new TypeError('edge requires from and to'); this.edges.push({ from, to, condition }); return this; }
  _next(nodeId, state) {
    const candidates = this.edges.filter(e => e.from === nodeId);
    const edge = candidates.find(e => !e.condition || e.condition(state) === true);
    return edge?.to || END;
  }
  _emit(event, state, extra = {}) { this.onEvent?.({ event, executionId: state.executionId, tenantId: state.tenantId, taskId: state.taskId, nodeId: state.nodeId, ...extra }); }
  async run(input, { tenantId, userId, taskId = null, context = {}, metadata = {}, executionId = randomUUID(), resume = true } = {}) {
    let state = resume ? this.store.load(executionId) : null;
    if (!state) state = createExecutionState({ executionId, tenantId, userId, taskId, input, context, metadata });
    if (state.status === ExecutionStatus.COMPLETED) return state;
    state = transitionExecution(state, ExecutionStatus.RUNNING, { nodeId: state.nodeId || START });
    this.store.save(state); this._emit('execution.started', state);
    try {
      let current = state.nodeId === START ? this._next(START, state) : state.nodeId;
      while (current !== END) {
        if (state.step >= this.maxSteps) throw new Error(`Execution exceeded maxSteps=${this.maxSteps}`);
        const handler = this.nodes.get(current); if (!handler) throw new Error(`Unknown execution node: ${current}`);
        state = transitionExecution(state, ExecutionStatus.RUNNING, { nodeId: current });
        this.store.save(state); this._emit('node.started', state);
        const output = await handler({ state: structuredClone(state), input: state.input, context: state.context });
        state = transitionExecution(state, ExecutionStatus.RUNNING, { nodeId: current, output });
        this.store.save(state); this._emit('node.completed', state);
        current = this._next(current, state);
      }
      state = transitionExecution(state, ExecutionStatus.COMPLETED, { nodeId: END });
      this.store.save(state); this._emit('execution.completed', state);
      return state;
    } catch (error) {
      state = transitionExecution(state, ExecutionStatus.FAILED, { error: { name: error.name, message: error.message }, nodeId: state.nodeId });
      this.store.save(state); this._emit('execution.failed', state, { error });
      throw error;
    }
  }
  pause(executionId) { const state = this.store.load(executionId); if (!state) throw new Error('Execution not found'); const next = transitionExecution(state, ExecutionStatus.PAUSED); this.store.save(next); return next; }
  resume(executionId, options = {}) { const state = this.store.load(executionId); if (!state) throw new Error('Execution not found'); return this.run(state.input, { ...options, executionId, tenantId: state.tenantId, userId: state.userId, taskId: state.taskId, context: state.context, metadata: state.metadata, resume: true }); }
}
