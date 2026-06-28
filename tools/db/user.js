// tools/db/user.js
// Persistent User Database Layer (AgentOS Core) — CJS

'use strict';

const Database = require('better-sqlite3');

const db = new Database('agentos.db');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  password TEXT,
  role TEXT DEFAULT 'user',
  chatId TEXT,
  status TEXT DEFAULT 'active',
  plan TEXT,
  expiry TEXT,
  createdAt TEXT,
  updatedAt TEXT
);
`);

module.exports = { db };