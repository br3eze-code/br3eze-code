export class InMemoryCheckpointStore {
  constructor() { this.records = new Map(); }
  async save(state) { this.records.set(state.executionId, structuredClone(state)); return structuredClone(state); }
  async load(executionId) { const value = this.records.get(executionId); return value ? structuredClone(value) : null; }
  async delete(executionId) { return this.records.delete(executionId); }
  async list({ tenantId } = {}) { return [...this.records.values()].filter(v => !tenantId || v.tenantId === tenantId).map(v => structuredClone(v)); }
}

export function assertCheckpointStore(store) {
  for (const method of ['save', 'load', 'delete']) {
    if (!store || typeof store[method] !== 'function') throw new TypeError(`CheckpointStore.${method}() is required`);
  }
  return store;
}
