import { logger } from './logger.js';

/**
 * AuditLogger — append-only audit trail for all RBAC decisions and tool calls
 * Writes to database.getAuditLog() when a db is available, always logs via logger.
 */

class AuditLogger {
  constructor(db = null, secret = null, clock = () => Date.now()) {
    this._db = db;
    this._secret = secret;
    this._clock = clock;
    this._queue = [];
  }

    async recordEvent(eventType, fields = {}) {
    if (!eventType || typeof eventType !== 'string') throw new TypeError('eventType is required');
    const record = {
      eventType,
      tenantId: fields.tenantId || null,
      siteId: fields.siteId || null,
      principalId: fields.principalId || fields.userId || null,
      channelIdentityId: fields.channelIdentityId || null,
      workId: fields.workId || null,
      loopId: fields.loopId || null,
      executionId: fields.executionId || null,
      resourceId: fields.resourceId || null,
      correlationId: fields.correlationId || fields.traceId || null,
      requestId: fields.requestId || null,
      decision: fields.decision || null,
      reason: fields.reason || null,
      status: fields.status || 'recorded',
      evidenceRefs: Array.isArray(fields.evidenceRefs) ? [...fields.evidenceRefs] : [],
      ts: new Date(this._clock ? this._clock() : Date.now()).toISOString()
    };
    if (!record.tenantId && (record.siteId || record.resourceId)) throw new Error('Tenant scope is required for site or resource audit events');
    logger.info(`[AUDIT_EVENT] ${record.eventType} tenantId=${record.tenantId || '—'} siteId=${record.siteId || '—'} correlationId=${record.correlationId || '—'}`);
    if (this._db && typeof this._db.addAuditEvent === 'function') {
      try { await this._db.addAuditEvent(record); } catch (_) { this._queue.push(record); }
    } else {
      this._queue.push(record);
    }
    return record;
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

const audit = {
  log: (...args) => getAuditLogger().log(...args),
  event: (...args) => getAuditLogger().recordEvent(...args)
};

export { AuditLogger, getAuditLogger, audit };
