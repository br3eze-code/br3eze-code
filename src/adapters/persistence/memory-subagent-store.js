export class MemorySubagentStore {
  constructor() { this.items = new Map(); }
  initialize() { return this; }
  create(item) { this.items.set(item.id, item); return item; }
  get(id) { return this.items.get(id) || null; }
  update(id, patch) {
    const current = this.get(id);
    if (!current) throw new Error(`Subagent not found: ${id}`);
    const next = { ...current, ...patch, updatedAt: Date.now() };
    this.items.set(id, next);
    return next;
  }
}
export default MemorySubagentStore;
