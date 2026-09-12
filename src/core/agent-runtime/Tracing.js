import { randomUUID } from 'node:crypto';

export class TraceCollector {
  constructor({ sink = null, clock = () => Date.now() } = {}) { this.sink = sink; this.clock = clock; this.spans = new Map(); }
  start(name, attributes = {}, parentId = null) {
    const id = randomUUID();
    const span = { id, name, parentId, attributes: structuredClone(attributes), startedAt: this.clock(), endedAt: null, durationMs: null, status: 'running', events: [] };
    this.spans.set(id, span); this.sink?.({ type: 'span.started', span: structuredClone(span) }); return id;
  }
  event(spanId, name, attributes = {}) { const span = this.spans.get(spanId); if (!span) return; span.events.push({ name, attributes: structuredClone(attributes), at: this.clock() }); this.sink?.({ type: 'span.event', spanId, name, attributes }); }
  end(spanId, status = 'ok', attributes = {}) { const span = this.spans.get(spanId); if (!span) return null; span.endedAt = this.clock(); span.durationMs = span.endedAt - span.startedAt; span.status = status; Object.assign(span.attributes, structuredClone(attributes)); this.sink?.({ type: 'span.ended', span: structuredClone(span) }); return structuredClone(span); }
  get(spanId) { const span = this.spans.get(spanId); return span ? structuredClone(span) : null; }
  list() { return [...this.spans.values()].map(span => structuredClone(span)); }
  clear() { this.spans.clear(); }
}

export default TraceCollector;
