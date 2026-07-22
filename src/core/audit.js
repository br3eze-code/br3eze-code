/**
 * AuditLogger — append-only audit trail for all RBAC decisions and tool calls
 * Writes to database.getAuditLog() when a db is available, always logs via logger.
 */
import { logger } from './logger.js';

class AuditLogger {
  constructor(db = null, secret = null) {
    this._db = db;
    this._secret = secret;
    this._queue = [];
  }

  async log(entry) {
    const record = {
      ts: new Date().toISOString(),
      ...entry,
    };
    logger.info(`[AUDIT] ${record.status} userId=${record.userId} tool=${record.tool?.name || record.tool || '—'} reason=${record.reason || '—'}`);
    if (this._db && typeof this._db.addAuditLog === 'function') {
      try { await this._db.addAuditLog(record); } catch (_) { /* db not ready, drop gracefully */ }
    } else {
      this._queue.push(record); // in-memory fallback
    }
    return record;
  }

  recent(n = 50) { return this._queue.slice(-n); }

  attachDB(db) { this._db = db; }
}

let _instance = null;
function getAuditLogger(db) {
  if (!_instance) _instance = new AuditLogger(db);
  if (db && !_instance._db) _instance.attachDB(db);
  return _instance;
}

const audit = { log: (...args) => getAuditLogger().log(...args) };

export { AuditLogger, getAuditLogger, audit };
