import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from './logger.js';
import { STATE_PATH } from './config.js';

/**
 * AgentOS SQLite Persistence Layer
 * Managed via better-sqlite3
 */

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

            this._db = new Database(DB_PATH, { verbose: (msg) => logger.debug(`[SQLite] ${msg}`) });
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
                createdAt TEXT,
                checksum TEXT
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
                vouchersUsed TEXT,
                createdAt TEXT,
                lastSeen TEXT,
                checksum TEXT
            );

            CREATE TABLE IF NOT EXISTS wallets (
                uid TEXT PRIMARY KEY,
                balance REAL,
                currency TEXT,
                lastUpdated TEXT
            );

            CREATE TABLE IF NOT EXISTS plans (
                id TEXT PRIMARY KEY,
                name TEXT,
                description TEXT,
                dataLimit TEXT,
                deviceLimit INTEGER,
                durationUnit TEXT,
                durationValue INTEGER,
                durationDays INTEGER,
                imageUrl TEXT,
                price REAL,
                active INTEGER,
                createdAt TEXT,
                features TEXT
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
                timestamp TEXT,
                createdAt TEXT,
                checksum TEXT,
                metadata TEXT
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

            CREATE TABLE IF NOT EXISTS user_lifecycle_graphs (
                uid TEXT PRIMARY KEY,
                tenantId TEXT,
                domain TEXT,
                siteId TEXT,
                graph TEXT,
                updatedAt TEXT
            );
        `;

        this._db.exec(schema);
        this._ensureColumn('users', 'vouchersUsed', 'TEXT');
        this._ensureColumn('plans', 'features', 'TEXT');
        this._ensureColumn('transactions', 'metadata', 'TEXT');
    }

    _ensureColumn(table, column, definition) {
        const columns = this._db.prepare(`PRAGMA table_info(${table})`).all();
        if (!columns.some((entry) => entry.name === column)) {
            this._db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        }
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
     * Deserialize a raw `users` table row into the same shape the
     * Firestore/in-memory tiers return (JSON columns parsed, `id` aliased
     * from `uid`).
     */
    static rowToUser(row) {
        if (!row) return null;
        return {
            ...row,
            id: row.uid,
            channels: SQLiteDB.fromDB(row.channels) || {},
            subscriptions: SQLiteDB.fromDB(row.subscriptions) || [],
            pendingNotification: SQLiteDB.fromDB(row.pendingNotification),
            vouchersUsed: SQLiteDB.fromDB(row.vouchersUsed) || [],
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

export { getSQLite, SQLiteDB };
