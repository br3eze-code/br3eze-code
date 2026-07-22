// src/core/memory/adapters/SQLiteAdapter.js
class SQLiteAdapter {
  constructor() {
    this.db = null;
  }

  async initialize() {
    const { getDatabase } = require('../../database');
    const dbInstance = await getDatabase();
    if (dbInstance && dbInstance.sqliteDB) {
      this.db = dbInstance.sqliteDB;
      await this._initTable();
    } else {
      // Fallback if sqliteDB isn't exposed directly, or assume SQLite isn't ready
      // Let's rely on standard database API
    }
  }

  async _initTable() {
    return new Promise((resolve, reject) => {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS agentos_memory (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at INTEGER,
          expires_at INTEGER
        )
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async get(key) {
    if (!this.db) return null;
    return new Promise((resolve, reject) => {
      this.db.get('SELECT value, expires_at FROM agentos_memory WHERE key = ?', [key], (err, row) => {
        if (err) return resolve(null);
        if (!row) return resolve(null);
        if (row.expires_at && row.expires_at < Date.now()) {
          this.db.run('DELETE FROM agentos_memory WHERE key = ?', [key]);
          return resolve(null);
        }
        try {
          resolve(JSON.parse(row.value));
        } catch (e) {
          resolve(null);
        }
      });
    });
  }

  async set(key, value, ttlSeconds = null) {
    if (!this.db) return;
    const expiresAt = ttlSeconds ? Date.now() + (ttlSeconds * 1000) : null;
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT OR REPLACE INTO agentos_memory (key, value, updated_at, expires_at) VALUES (?, ?, ?, ?)',
        [key, JSON.stringify(value), Date.now(), expiresAt],
        (err) => {
          if (err) resolve(); // ignore error
          else resolve();
        }
      );
    });
  }

  async push(key, value) {
    const arr = (await this.get(key)) || [];
    arr.push(value);
    await this.set(key, arr);
  }

  async trim(key, count) {
    const arr = (await this.get(key)) || [];
    if (count < 0) {
      await this.set(key, arr.slice(count));
    } else {
      await this.set(key, arr.slice(0, count));
    }
  }

  async close() {
    // DB is managed globally
  }

  getStatus() {
    return {
      type: 'sqlite',
      ready: !!this.db
    };
  }
}

module.exports = SQLiteAdapter;
