import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Durable SubagentStore adapter. Core lifecycle remains persistence-agnostic. */
export class SqliteSubagentStore {
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
      this._db.pragma('journal_mode = WAL');
      this._db.exec(`
        CREATE TABLE IF NOT EXISTS agent_subagents (
          id TEXT PRIMARY KEY,
          parentId TEXT,
          role TEXT NOT NULL,
          scope TEXT NOT NULL,
          permissions TEXT NOT NULL,
          depth INTEGER NOT NULL,
          budget REAL NOT NULL,
          spent REAL NOT NULL DEFAULT 0,
          status TEXT NOT NULL,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL,
          error TEXT,
          handoff TEXT,
          terminationReason TEXT,
          metadata TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_subagents_parent ON agent_subagents(parentId);
        CREATE INDEX IF NOT EXISTS idx_agent_subagents_status ON agent_subagents(status);
      `);
    } catch (error) {
      this.logger.warn?.('[SqliteSubagentStore] SQLite unavailable; using memory:', error.message);
    }
    return this;
  }

  _serialize(item) {
    return {
      ...item,
      scope: JSON.stringify(item.scope || {}),
      permissions: JSON.stringify(item.permissions || []),
      handoff: item.handoff == null ? null : JSON.stringify(item.handoff),
      metadata: JSON.stringify(item.metadata || {}),
    };
  }

  _deserialize(row) {
    if (!row) return null;
    return {
      ...row,
      scope: JSON.parse(row.scope || '{}'),
      permissions: JSON.parse(row.permissions || '[]'),
      handoff: row.handoff ? JSON.parse(row.handoff) : undefined,
      metadata: JSON.parse(row.metadata || '{}'),
    };
  }

  create(item) {
    if (!item?.id) throw new TypeError('subagent id is required');
    const value = { ...item, updatedAt: item.updatedAt || Date.now() };
    this._mem.set(value.id, value);
    if (!this._db) return value;
    const row = this._serialize(value);
    this._db.prepare(`INSERT INTO agent_subagents
      (id,parentId,role,scope,permissions,depth,budget,spent,status,createdAt,updatedAt,error,handoff,terminationReason,metadata)
      VALUES (@id,@parentId,@role,@scope,@permissions,@depth,@budget,@spent,@status,@createdAt,@updatedAt,@error,@handoff,@terminationReason,@metadata)`).run({
      ...row, error: value.error || null, terminationReason: value.terminationReason || null,
    });
    return value;
  }

  get(id) {
    if (this._mem.has(id)) return this._mem.get(id);
    if (!this._db) return null;
    const value = this._deserialize(this._db.prepare('SELECT * FROM agent_subagents WHERE id = ?').get(id));
    if (value) this._mem.set(id, value);
    return value;
  }

  update(id, patch = {}) {
    const current = this.get(id);
    if (!current) throw new Error(`Subagent not found: ${id}`);
    const value = { ...current, ...patch, id, updatedAt: Date.now() };
    this._mem.set(id, value);
    if (!this._db) return value;
    const row = this._serialize(value);
    this._db.prepare(`UPDATE agent_subagents SET
      parentId=@parentId, role=@role, scope=@scope, permissions=@permissions,
      depth=@depth, budget=@budget, spent=@spent, status=@status,
      updatedAt=@updatedAt, error=@error, handoff=@handoff,
      terminationReason=@terminationReason, metadata=@metadata WHERE id=@id`).run({
      ...row, error: value.error || null, terminationReason: value.terminationReason || null,
    });
    return value;
  }

  list({ parentId = undefined, status = undefined } = {}) {
    if (!this._db) {
      return [...this._mem.values()].filter((item) =>
        (parentId === undefined || item.parentId === parentId) &&
        (status === undefined || item.status === status)
      );
    }
    const rows = parentId === undefined
      ? this._db.prepare(status === undefined ? 'SELECT * FROM agent_subagents ORDER BY createdAt' : 'SELECT * FROM agent_subagents WHERE status=? ORDER BY createdAt').all(...(status === undefined ? [] : [status]))
      : this._db.prepare(status === undefined ? 'SELECT * FROM agent_subagents WHERE parentId=? ORDER BY createdAt' : 'SELECT * FROM agent_subagents WHERE parentId=? AND status=? ORDER BY createdAt').all(...(status === undefined ? [parentId] : [parentId, status]));
    return rows.map((row) => this._deserialize(row));
  }
}

export default SqliteSubagentStore;
