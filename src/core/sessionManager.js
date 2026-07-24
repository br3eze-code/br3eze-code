import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/**
 * SessionManager — SQLite-backed session lifecycle
 * ─────────────────────────────────────────────────────────────────
 * Completes the stub: implements createWorktree, atomicWrite,
 * getSession, getValidTransitions, emitEvent.
 *
 * Falls back to in-memory Map when SQLite is unavailable (CI/test).
 * Existing callers unchanged: createSession(config), transition(id, state)
 * ─────────────────────────────────────────────────────────────────
 */


const STATE_MACHINE = {
  initializing: ['running', 'failed'],
  running:      ['paused', 'completed', 'failed'],
  paused:       ['running', 'failed'],
  completed:    [],
  failed:       ['initializing'],
};

class SessionManager extends EventEmitter {
  constructor(opts = {}) {
    super();
    this._mem   = new Map();
    this._db    = null;
    const dbDir = opts.dbPath || process.env.AGENTOS_STATE_PATH || path.join(process.cwd(), 'data');
    this._dbPath = path.join(dbDir, 'agentos.sqlite');
    this._initDB();
  }

  _initDB() {
    try {
      const Database = require('better-sqlite3');
      const fs = require('fs');
      require('fs').mkdirSync(path.dirname(this._dbPath), { recursive: true });
      this._db = new Database(this._dbPath);
      this._db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id          TEXT PRIMARY KEY,
          domain      TEXT,
          state       TEXT NOT NULL DEFAULT 'initializing',
          checkpoint  INTEGER,
          retryCount  INTEGER NOT NULL DEFAULT 0,
          recoverable INTEGER NOT NULL DEFAULT 1,
          createdAt   INTEGER NOT NULL,
          updatedAt   INTEGER NOT NULL,
          meta        TEXT
        );
      `);
    } catch (_) {
      // SQLite not available — use in-memory only
      this._db = null;
    }
  }

  // ── createWorktree: lightweight context dir (not git worktree) ───────────
  async createWorktree(config) {
    const id   = crypto.randomUUID().slice(0, 8);
    const base = process.env.MEMORY_BASE_PATH || '/tmp/sessions';
    const dir  = path.join(base, id);
    try {
      require('fs').mkdirSync(dir, { recursive: true });
    } catch (_) { /* /tmp may not be writable in all envs */ }
    return { id, path: dir, domain: config.domain };
  }

  // ── atomicWrite ──────────────────────────────────────────────────────────
  async atomicWrite(session) {
    this._mem.set(session.id, session);
    if (!this._db) return session;
    const now = Date.now();
    this._db.prepare(`
      INSERT OR REPLACE INTO sessions
        (id, domain, state, checkpoint, retryCount, recoverable, createdAt, updatedAt, meta)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      session.id,
      session.domain || null,
      session.state,
      session.checkpoint || now,
      session.retryCount || 0,
      session.recoverable ? 1 : 0,
      session.createdAt || now,
      now,
      JSON.stringify(session.worktree || {})
    );
    return session;
  }

  // ── getSession ───────────────────────────────────────────────────────────
  async getSession(id) {
    if (this._mem.has(id)) return this._mem.get(id);
    if (this._db) {
      const row = this._db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
      if (row) {
        const s = { ...row, recoverable: !!row.recoverable, worktree: JSON.parse(row.meta || '{}') };
        this._mem.set(id, s);
        return s;
      }
    }
    return null;
  }

  // ── getValidTransitions ──────────────────────────────────────────────────
  getValidTransitions(state) {
    return STATE_MACHINE[state] || [];
  }

  // ── emitEvent ────────────────────────────────────────────────────────────
  emitEvent(name, data) {
    this.emit(name, data);
  }

  // ── createSession (original stub API) ────────────────────────────────────
  async createSession(config) {
    const session = {
      id:          crypto.randomUUID(),
      domain:      config.domain || 'default',
      worktree:    await this.createWorktree(config),
      state:       'initializing',
      checkpoint:  Date.now(),
      recoverable: true,
      retryCount:  0,
      createdAt:   Date.now(),
    };
    await this.atomicWrite(session);
    return session;
  }

  // ── transition (original stub API) ───────────────────────────────────────
  async transition(sessionId, toState) {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    const valid = this.getValidTransitions(session.state);
    if (!valid.includes(toState)) {
      throw new Error(`Invalid transition: ${session.state} → ${toState}`);
    }
    session.state      = toState;
    session.checkpoint = Date.now();
    await this.atomicWrite(session);
    this.emitEvent('session.transition', { sessionId, toState });
    return session;
  }

  // ── listSessions ─────────────────────────────────────────────────────────
  async listSessions(filter = {}) {
    if (this._db) {
      const rows = this._db.prepare('SELECT * FROM sessions').all();
      return rows
        .map(r => ({ ...r, recoverable: !!r.recoverable }))
        .filter(s => !filter.domain || s.domain === filter.domain)
        .filter(s => !filter.state  || s.state  === filter.state);
    }
    return [...this._mem.values()].filter(s =>
      (!filter.domain || s.domain === filter.domain) &&
      (!filter.state  || s.state  === filter.state)
    );
  }
}

export default SessionManager;
