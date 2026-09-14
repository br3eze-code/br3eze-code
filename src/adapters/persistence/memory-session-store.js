import crypto from 'node:crypto';

const VALID_TRANSITIONS = {
  initializing: ['running', 'failed'],
  running: ['paused', 'completed', 'failed'],
  paused: ['running', 'failed'],
  completed: [],
  failed: ['initializing'],
};

export class MemorySessionStore {
  constructor() { this.sessions = new Map(); }

  initialize() { return this; }

  create(config = {}) {
    const now = Date.now();
    const session = {
      id: config.id || crypto.randomUUID(),
      domain: config.domain || 'default',
      state: 'initializing', checkpoint: now, retryCount: 0,
      recoverable: true, createdAt: now, updatedAt: now,
      meta: config.meta || {},
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id) { return this.sessions.get(id) || null; }

  transition(id, toState) {
    const session = this.get(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    if (!(VALID_TRANSITIONS[session.state] || []).includes(toState)) {
      throw new Error(`Invalid transition: ${session.state} -> ${toState}`);
    }
    const now = Date.now();
    session.state = toState;
    session.updatedAt = now;
    session.checkpoint = now;
    return session;
  }
}

export default MemorySessionStore;
