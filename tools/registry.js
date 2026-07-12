// tools/registry.js
// AgentOS — Tool Registry System — CJS

'use strict';

// ─── LOAD TOOL GROUPS ─────────────────────────────────

// Each group module exports named functions
import mikrotik from './mikrotik/index.js.js';
import telegram from './telegram/index.js.js';
import db from './db/index.js.js';
import payments from './payments/index.js.js';
import system from './system/index.js.js';

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
    ...prefix('db',       db),
    ...prefix('payments', payments),
    ...prefix('system',   system)
};

export { tools };
