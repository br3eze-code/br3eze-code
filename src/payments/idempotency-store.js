import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export class FileIdempotencyStore {
  constructor({ filePath } = {}) {
    this.filePath = filePath || path.join(process.cwd(), 'state', 'payment-idempotency.json');
    ensureParent(this.filePath);
    this.records = this.read();
  }

  read() {
    try { return JSON.parse(fs.readFileSync(this.filePath, 'utf8')); } catch { return {}; }
  }

  persist() {
    const temp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.records), { mode: 0o600 });
    fs.renameSync(temp, this.filePath);
  }

  cleanup(now = Date.now()) {
    let changed = false;
    for (const [key, record] of Object.entries(this.records)) {
      if (record.expiresAt <= now) { delete this.records[key]; changed = true; }
    }
    if (changed) this.persist();
  }

  get(key) {
    this.cleanup();
    const record = this.records[key];
    if (!record) return undefined;
    return record.state === 'completed' ? record.result : { pending: true, state: record.state, metadata: record.metadata || {} };
  }

  reserve(key, metadata = {}, ttlMs = 86400000) {
    this.cleanup();
    if (this.records[key]) return false;
    const now = Date.now();
    this.records[key] = { state: 'pending', metadata, createdAt: now, expiresAt: now + ttlMs };
    this.persist();
    return true;
  }

  set(key, value, ttlMs = 86400000) {
    const now = Date.now();
    this.records[key] = { state: 'completed', result: value, createdAt: this.records[key]?.createdAt || now, updatedAt: now, expiresAt: now + ttlMs };
    this.persist();
    return value;
  }

  close() {}
}

export class SqliteIdempotencyStore {
  constructor({ dbPath = process.env.AGENTOS_PAYMENT_DB_PATH || path.join(process.cwd(), 'state', 'payment-ledger.sqlite'), ttlMs = 86400000 } = {}) {
    this.dbPath = dbPath;
    this.ttlMs = ttlMs;
    ensureParent(dbPath);
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS payment_idempotency (
      idempotency_key TEXT PRIMARY KEY,
      state TEXT NOT NULL CHECK (state IN ('pending', 'completed')),
      result_json TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS idx_payment_idempotency_expiry ON payment_idempotency (expires_at);`);
    this.cleanup();
  }

  cleanup(now = Date.now()) { this.db.prepare('DELETE FROM payment_idempotency WHERE expires_at <= ?').run(now); }

  get(key) {
    const row = this.db.prepare('SELECT state, result_json, metadata_json FROM payment_idempotency WHERE idempotency_key = ? AND expires_at > ?').get(key, Date.now());
    if (!row) return undefined;
    return row.state === 'completed' ? JSON.parse(row.result_json) : { pending: true, state: row.state, metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {} };
  }

  reserve(key, metadata = {}) {
    const now = Date.now();
    return this.db.prepare(`INSERT INTO payment_idempotency (idempotency_key,state,metadata_json,created_at,updated_at,expires_at) VALUES (?, 'pending', ?, ?, ?, ?) ON CONFLICT(idempotency_key) DO NOTHING`).run(key, JSON.stringify(metadata), now, now, now + this.ttlMs).changes === 1;
  }

  set(key, value) {
    const now = Date.now();
    this.db.prepare(`INSERT INTO payment_idempotency (idempotency_key,state,result_json,created_at,updated_at,expires_at) VALUES (?, 'completed', ?, ?, ?, ?) ON CONFLICT(idempotency_key) DO UPDATE SET state='completed', result_json=excluded.result_json, updated_at=excluded.updated_at, expires_at=excluded.expires_at`).run(key, JSON.stringify(value), now, now, now + this.ttlMs);
    return value;
  }

  close() { this.db.close(); }
}

export function createPaymentIdempotencyStore(options = {}) {
  try { return new SqliteIdempotencyStore(options); }
  catch (error) {
    if (process.env.AGENTOS_REQUIRE_NATIVE_SQLITE === '1') throw error;
    console.warn('[AgentOS] Native SQLite unavailable; using durable file idempotency store.');
    return new FileIdempotencyStore({ filePath: options.filePath || `${options.dbPath || path.join(process.cwd(), 'state', 'payment-ledger.sqlite')}.json` });
  }
}

export default SqliteIdempotencyStore;
