import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const VALID_TRANSITIONS = {
  initializing: ['running', 'failed'],
  running: ['paused', 'completed', 'failed'],
  paused: ['running', 'failed'],
  completed: [],
  failed: ['initializing'],
};

export class SqliteSessionStore {
  constructor({ dbPath, logger = console } = {}) {
    if (!dbPath) throw new TypeError('dbPath is required');
    this.dbPath = dbPath;
    this.logger = logger;
    this._db = null;
    this._mem = new Map();
  }

  initialize() {
    if (this._db) return this;
    try {
      const fs = require('node:fs');
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
      const Database = require('better-sqlite3');
      this._db = new Database(this.dbPath);
      this._db.exec(`
        CREATE TABLE IF NOT EXISTS agent_sessions (
          id TEXT PRIMARY KEY,
          domain TEXT,
          state TEXT NOT NULL DEFAULT 'initializing',
          checkpoint INTEGER,
          retryCount INTEGER NOT NULL DEFAULT 0,
          recoverable INTEGER NOT NULL DEFAULT 1,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL,
          meta TEXT
        );
      `);
    } catch (error) {
      this.logger.warn?.('[SqliteSessionStore] SQLite unavailable; using memory:', error.message);
    }
    return this;
  }

  _write(session) {
    this._mem.set(session.id, session);
    if (!this._db) return session;
    this._db.prepare(`
      INSERT OR REPLACE INTO agent_sessions
      (id,domain,state,checkpoint,retryCount,recoverable,createdAt,updatedAt,meta)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      session.id, session.domain, session.state, session.checkpoint,
      session.retryCount || 0, session.recoverable ? 1 : 0,
      session.createdAt, session.updatedAt || session.createdAt,
      JSON.stringify(session.meta || {})
    );
    return session;
  }

  create(config = {}) {
    const now = Date.now();
    return this._write({
      id: config.id || crypto.randomUUID(),
      domain: config.domain || 'default',
      state: 'initializing', checkpoint: now, retryCount: 0,
      recoverable: true, createdAt: now, updatedAt: now,
      meta: config.meta || {},
    });
  }

  get(id) {
    if (this._mem.has(id)) return this._mem.get(id);
    if (!this._db) return null;
    const row = this._db.prepare('SELECT * FROM agent_sessions WHERE id=?').get(id);
    if (!row) return null;
    const session = { ...row, recoverable: !!row.recoverable, meta: JSON.parse(row.meta || '{}') };
    this._mem.set(id, session);
    return session;
  }

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
    return this._write(session);
  }
}

export default SqliteSessionStore;
