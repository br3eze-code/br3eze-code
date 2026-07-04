'use strict';
/**
 * AgentOS SQLite Persistence Layer
 * Managed via better-sqlite3
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { logger } = require('./logger');
const { STATE_PATH } = require('./config');

const DB_PATH = path.join(STATE_PATH, 'agentos.db');

class SQLiteDB {
  constructor() {
    this._db = null;
  }

  async connect() {
    if (this._db) return this._db;

    try {
      if (!fs.existsSync(STATE_PATH)) {
        fs.mkdirSync(STATE_PATH, { recursive: true });
      }

      this._db = new Database(DB_PATH, { verbose: msg => logger.debug(`[SQLite] ${msg}`) });
      this._db.pragma('journal_mode = WAL');
      this._initSchema();

      logger.info(`SQLite: connected to ${DB_PATH}`);
      return this._db;
    } catch (err) {
      logger.error(`SQLite connection failed: ${err.message}`);
      throw err;
    }
  }

  _initSchema() {
    const schema = `
            CREATE TABLE IF NOT EXISTS vouchers (
                code TEXT PRIMARY KEY,
                status TEXT,
                used INTEGER,
                usedAt TEXT,
                usedBy TEXT,
                redeemedByUsername TEXT,
                plan TEXT,
                planName TEXT,
                durationUnit TEXT,
                durationValue INTEGER,
                deviceLimit INTEGER,
                value REAL,
                currency TEXT,
                loginUrl TEXT,
                expiresAt TEXT,
                createdBy TEXT,
                redemption TEXT,
                createdAt TEXT
            );

            CREATE TABLE IF NOT EXISTS users (
                uid TEXT PRIMARY KEY,
                username TEXT,
                fullname TEXT,
                email TEXT,
                phoneNumber TEXT,
                address TEXT,
                platform TEXT,
                deviceModel TEXT,
                lastIP TEXT,
                role TEXT,
                credits REAL,
                subscriptions TEXT,
                pendingNotification TEXT,
                channels TEXT,
                createdAt TEXT,
                lastSeen TEXT
            );

            CREATE TABLE IF NOT EXISTS wallets (
                id TEXT PRIMARY KEY,
                balance REAL,
                currency TEXT,
                lastUpdated TEXT
            );

            CREATE TABLE IF NOT EXISTS plans (
                id TEXT PRIMARY KEY,
                name TEXT,
                description TEXT,
                value REAL,
                currency TEXT,
                durationUnit TEXT,
                durationValue INTEGER,
                deviceLimit INTEGER,
                speedLimit TEXT,
                dataLimit TEXT,
                features TEXT,
                active INTEGER,
                createdAt TEXT
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id TEXT PRIMARY KEY,
                type TEXT,
                voucherCode TEXT,
                userId TEXT,
                amount REAL,
                currency TEXT,
                status TEXT,
                description TEXT,
                metadata TEXT,
                timestamp TEXT,
                createdAt TEXT
            );

            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action TEXT,
                actor TEXT,
                target TEXT,
                payload TEXT,
                timestamp TEXT
            );

            CREATE TABLE IF NOT EXISTS mikrotik_state (
                id TEXT PRIMARY KEY,
                data TEXT,
                updatedAt TEXT
            );

            CREATE TABLE IF NOT EXISTS sessions (
                sessionId TEXT PRIMARY KEY,
                userId TEXT,
                messages TEXT,
                usage TEXT,
                savedAt TEXT
            );
        `;

    this._db.exec(schema);

    // ── Incremental migrations (safe: ignored if column already exists) ──────
    const _addColumn = (table, column, definition) => {
      try {
        this._db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        logger.debug(`[SQLite] Added column ${table}.${column}`);
      } catch (e) {
        if (!e.message.includes('duplicate column')) {
          logger.warn(`[SQLite] Migration ${table}.${column}: ${e.message}`);
        }
      }
    };

    _addColumn('users', 'password_hash', 'TEXT');
    _addColumn('users', 'lastLoginSource', 'TEXT');
    _addColumn('vouchers', 'amount', 'REAL');
    _addColumn('vouchers', 'method', 'TEXT');
  }

  /**
   * Generic helper for JSON serialization
   */
  static toDB(data) {
    if (data === null || data === undefined) return null;
    if (typeof data === 'object') return JSON.stringify(data);
    return data;
  }

  static fromDB(data) {
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }

  /**
   * Deserialize a `users` table row into the same shape Firestore returns.
   * The JSON-blob columns (subscriptions, pendingNotification, channels)
   * need per-field JSON.parse — fromDB(row) on the whole row silently
   * no-ops (JSON.parse on an object coerces to "[object Object]", fails,
   * and the catch just returns the row unchanged), which was the actual
   * previous behavior: those three fields came back as raw JSON strings,
   * not parsed objects, so e.g. user.channels.telegram was always undefined.
   *
   * FIX: Parse each JSON column individually, preserving all other fields,
   * and add a properly-keyed `id` field (mapped from `uid`).
   */
  static rowToUser(row) {
    if (!row) return null;
    return {
      id: row.uid,
      uid: row.uid,
      username: row.username,
      fullname: row.fullname,
      email: row.email,
      phoneNumber: row.phoneNumber,
      address: row.address,
      platform: row.platform,
      deviceModel: row.deviceModel,
      lastIP: row.lastIP,
      role: row.role,
      credits: row.credits,
      subscriptions: SQLiteDB.fromDB(row.subscriptions) || [],
      pendingNotification: SQLiteDB.fromDB(row.pendingNotification) || {},
      channels: SQLiteDB.fromDB(row.channels) || {},
      createdAt: row.createdAt,
      lastSeen: row.lastSeen,
    };
  }

  /**
   * Deserialize a `plans` table row
   */
  static rowToPlan(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      value: row.value,
      currency: row.currency,
      durationUnit: row.durationUnit,
      durationValue: row.durationValue,
      deviceLimit: row.deviceLimit,
      speedLimit: row.speedLimit,
      dataLimit: row.dataLimit,
      features: SQLiteDB.fromDB(row.features) || {},
      active: row.active === 1,
      createdAt: row.createdAt,
    };
  }

  /**
   * Deserialize a `vouchers` table row
   */
  static rowToVoucher(row) {
    if (!row) return null;
    return {
      id: row.code,
      code: row.code,
      status: row.status,
      used: row.used === 1,
      usedAt: row.usedAt,
      usedBy: row.usedBy,
      redeemedByUsername: row.redeemedByUsername,
      plan: row.plan,
      planName: row.planName,
      durationUnit: row.durationUnit,
      durationValue: row.durationValue,
      deviceLimit: row.deviceLimit,
      value: row.value,
      currency: row.currency,
      loginUrl: row.loginUrl,
      expiresAt: row.expiresAt,
      createdBy: row.createdBy,
      redemption: SQLiteDB.fromDB(row.redemption) || {},
      createdAt: row.createdAt,
    };
  }
}

// Singleton
let instance = null;
async function getSQLite() {
  if (!instance) {
    instance = new SQLiteDB();
    await instance.connect();
  }
  return instance._db;
}

module.exports = { getSQLite, SQLiteDB };
