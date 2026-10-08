/**
 * Session event log — domain-agnostic durable execution history.
 *
 * The runtime records facts, not derived state. Consumers can project the
 * event stream into conversation history, metrics, checkpoints, or UI state.
 * Storage is injected so the core has no Firebase/Supabase/database dependency.
 */

export const SESSION_EVENT_VERSION = 1;

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

export class InMemorySessionStore {
  constructor() {
    this.sessions = new Map();
  }

  async append(sessionId, event) {
    const events = this.sessions.get(sessionId) || [];
    const next = { ...clone(event), seq: events.length + 1 };
    events.push(next);
    this.sessions.set(sessionId, events);
    return clone(next);
  }

  async read(sessionId, { after = 0, limit = Infinity } = {}) {
    const events = this.sessions.get(sessionId) || [];
    return clone(events.slice(after, after + limit));
  }

  async getLast(sessionId) {
    const events = this.sessions.get(sessionId) || [];
    return clone(events.at(-1) || null);
  }

  async close() {}
}

export class SessionStore {
  constructor({ store = new InMemorySessionStore(), clock = () => new Date().toISOString() } = {}) {
    this.store = store;
    this.clock = clock;
  }

  async append(sessionId, type, data = {}, meta = {}) {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new TypeError('sessionId must be a non-empty string');
    }
    if (!type || typeof type !== 'string') {
      throw new TypeError('event type must be a non-empty string');
    }

    return this.store.append(sessionId, {
      version: SESSION_EVENT_VERSION,
      id: meta.id || cryptoRandomId(),
      sessionId,
      type,
      timestamp: meta.timestamp || this.clock(),
      data: clone(data),
      meta: clone(meta),
    });
  }

  read(sessionId, options) {
    return this.store.read(sessionId, options);
  }

  getLast(sessionId) {
    return this.store.getLast(sessionId);
  }

  close() {
    return this.store.close?.();
  }
}

function cryptoRandomId() {
  return globalThis.crypto?.randomUUID?.()
    || \${Date.now().toString(36)}-\${Math.random().toString(36).slice(2)};
}
