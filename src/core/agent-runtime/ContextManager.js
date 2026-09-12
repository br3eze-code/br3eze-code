export class ContextManager {
  constructor({ maxItems = 40, summarizer = null, retriever = null } = {}) { this.maxItems = maxItems; this.summarizer = summarizer; this.retriever = retriever; }
  append(context = {}, item) { const messages = [...(context.messages || []), item].slice(-this.maxItems); return { ...context, messages }; }
  async compact(context = {}) { if (context.messages?.length <= this.maxItems) return context; if (!this.summarizer) return { ...context, messages: context.messages.slice(-this.maxItems) }; return { ...context, messages: await this.summarizer(context.messages.slice(0, -this.maxItems)), recent: context.messages.slice(-this.maxItems) }; }
  async retrieve(query, scope) { return this.retriever ? this.retriever({ query, scope }) : []; }
}

export class InMemoryMemoryStore {
  constructor() { this.records = new Map(); }
  _key(scope, key) { if (!scope?.tenantId) throw new Error('tenantId is required'); return `${scope.tenantId}:${scope.userId || '*'}:${scope.agentId || '*'}:${scope.taskId || '*'}:${key}`; }
  write(scope, key, value) { this.records.set(this._key(scope, key), structuredClone(value)); return value; }
  read(scope, key) { const value = this.records.get(this._key(scope, key)); return value === undefined ? null : structuredClone(value); }
  delete(scope, key) { return this.records.delete(this._key(scope, key)); }
}
