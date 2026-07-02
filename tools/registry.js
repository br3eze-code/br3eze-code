// tools/registry.js
// AgentOS — Tool Registry System — CJS

'use strict';

// ─── LOAD TOOL GROUPS ─────────────────────────────────

// Each group module exports named functions
const mikrotik = require('./mikrotik/index.js');
const telegram = require('./telegram/index.js');
const db = require('./db/index.js');
const payments = require('./payments/index.js');
const system = require('./system/index.js');

// ─── PREFIX HELPER ────────────────────────────────────
/**
 * Converts { createUser } into { "mikrotik.createUser": fn }
 */
function prefix(namespace, group) {
  const mapped = {};
  for (const key of Object.keys(group)) {
    mapped[`${namespace}.${key}`] = group[key];
  }
  return mapped;
}

// ─── TOOL REGISTRY MAP ────────────────────────────────

const tools = {
  ...prefix('mikrotik', mikrotik),
  ...prefix('telegram', telegram),
  ...prefix('db', db),
  ...prefix('payments', payments),
  ...prefix('system', system),
};

module.exports = { tools };
