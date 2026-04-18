'use strict';

import Database from "better-sqlite3";
import crypto from "crypto";

const db = new Database("agentos.db");

// ─────────────────────────────
// INIT TABLES
// ─────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'user' CHECK(role IN ('user', 'admin', 'readonly')),
  chatId TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'banned')),
  plan TEXT,
  expiry TEXT,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
`);

// ─────────────────────────────
// HELPERS
// ─────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const verify = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return hash === verify;
}

function generateId() {
  return crypto.randomUUID();
}

// ─────────────────────────────
// CRUD OPERATIONS
// ─────────────────────────────
export function createUser({ username, password, role = 'user', chatId, plan, expiry }) {
  if (!username || !password) throw new Error('Username and password required');
  if (username.length < 3 || username.length > 32) throw new Error('Username must be 3-32 chars');
  
  const stmt = db.prepare(`
    INSERT INTO users (id, username, password, role, chatId, plan, expiry)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  return stmt.run(
    generateId(),
    username.toLowerCase().trim(),
    hashPassword(password),
    role,
    chatId || null,
    plan || null,
    expiry || null
  );
}

export function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase().trim());
}

export function authenticateUser(username, password) {
  const user = getUserByUsername(username);
  if (!user) return null;
  if (user.status !== 'active') return null;
  if (!verifyPassword(password, user.password)) return null;
  
  const { password: _, ...safeUser } = user;
  return safeUser;
}

export function updateUser(id, updates) {
  const allowed = ['role', 'status', 'plan', 'expiry', 'chatId'];
  const fields = [];
  const values = [];
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowed.includes(key)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  
  if (fields.length === 0) throw new Error('No valid fields to update');
  
  values.push(id);
  const stmt = db.prepare(`UPDATE users SET ${fields.join(', ')}, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`);
  return stmt.run(...values);
}

export function listUsers({ status, role, limit = 100, offset = 0 } = {}) {
  let sql = 'SELECT id, username, role, status, plan, expiry, createdAt FROM users WHERE 1=1';
  const params = [];
  
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (role) { sql += ' AND role = ?'; params.push(role); }
  
  sql += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  
  return db.prepare(sql).all(...params);
}

export function deleteUser(id) {
  return db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

export default db;
