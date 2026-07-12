'use strict';
/**
 * AgentKernel — domain-agnostic orchestrator
 *
 * BACKWARD COMPATIBLE: existing callers unchanged —
 *   new AgentKernel()
 *   kernel.registerDomain(id, adapter)
 *   kernel.dispatch(agentConfig, context)
 *
 * Added (non-breaking):
 *   kernel.init([dbPath])          — SQLite session store
 *   kernel.resolveDomain(intent)   — real implementation
 *   kernel.status()                — introspection
 *
 * No direct imports from domains/, adapters/, mikrotik, etc.
 */

const EventEmitter = require('events');
const crypto       = require('crypto');
const path         = require('path');
const sdk          = require('../plugin-sdk');

let _logger;
function log(level, ...a) {
  try { _logger = _logger || require('./logger').logger; _logger[level](...a); }
  catch (_) { console[level === 'debug' ? 'debug' : level === 'warn' ? 'warn' : 'log'](...a); }
}

// ── Embedded session store (SQLite + Map fallback) ───────────────────────────
class _SessionStore {
  constructor() { this._mem = new Map(); this._db = null; }

  init(dbPath) {
    try {
      const fs = require('fs');
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const DB = require('better-sqlite3');
      this._db = new DB(dbPath);
      this._db.exec(`
        CREATE TABLE IF NOT EXISTS agent_sessions (
          id TEXT PRIMARY KEY, domain TEXT, state TEXT NOT NULL DEFAULT 'initializing',
          checkpoint INTEGER, retryCount INTEGER NOT NULL DEFAULT 0,
          recoverable INTEGER NOT NULL DEFAULT 1,
          createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, meta TEXT
        );
      `);
      log('info', '[AgentKernel] SQLite session store:', dbPath);
    } catch (e) {
      log('warn', '[AgentKernel] SQLite unavailable, using in-memory sessions:', e.message);
    }
  }

  _write(s) {
    this._mem.set(s.id, s);
    if (!this._db) return;
    this._db.prepare(
      `INSERT OR REPLACE INTO agent_sessions
       (id,domain,state,checkpoint,retryCount,recoverable,createdAt,updatedAt,meta)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(s.id, s.domain, s.state, s.checkpoint, s.retryCount || 0,
      s.recoverable ? 1 : 0, s.createdAt, s.updatedAt || s.createdAt,
      JSON.stringify(s.meta || {}));
  }

  create(config) {
    const now = Date.now();
    const s = {
      id: crypto.randomUUID(), domain: config.domain || 'default',
      state: 'initializing', checkpoint: now, retryCount: 0,
      recoverable: true, createdAt: now, updatedAt: now, meta: config.meta || {},
    };
    this._write(s);
    return s;
  }

  get(id) {
    if (this._mem.has(id)) return this._mem.get(id);
    if (this._db) {
      const row = this._db.prepare('SELECT * FROM agent_sessions WHERE id=?').get(id);
      if (row) { const s = { ...row, recoverable: !!row.recoverable, meta: JSON.parse(row.meta || '{}') }; this._mem.set(id, s); return s; }
    }
    return null;
  }

  transition(id, toState) {
    const VALID = {
      initializing: ['running', 'failed'],
      running:      ['paused', 'completed', 'failed'],
      paused:       ['running', 'failed'],
      completed:    [],
      failed:       ['initializing'],
    };
    const s = this.get(id);
    if (!s) throw new Error(`Session not found: ${id}`);
    if (!(VALID[s.state] || []).includes(toState))
      throw new Error(`Invalid transition: ${s.state} -> ${toState}`);
    s.state = toState; s.updatedAt = Date.now(); s.checkpoint = Date.now();
    this._write(s);
    return s;
  }
}

// ── AgentKernel ──────────────────────────────────────────────────────────────
class AgentKernel extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.domains  = new Map();
    this.agents   = new Map();
    this._sessions = new _SessionStore();
    this._opts    = opts;
    this._ready   = false;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  init(dbPath) {
    const p = dbPath || this._opts.dbPath ||
      path.join(process.env.AGENTOS_STATE_PATH || path.join(process.cwd(), 'data'), 'agentos.sqlite');
    this._sessions.init(p);
    this._ready = true;
    this.emit('kernel:ready', { domains: this.domains.size });
    log('info', `[AgentKernel] ready — ${this.domains.size} domain(s)`);
    return this;
  }

  // ── Domain registration ────────────────────────────────────────────────────
  registerDomain(domainId, adapter) {
    const entry = sdk.registerDomain(domainId, adapter);
    this.domains.set(domainId, entry);
    this.emit('domain:registered', { domainId, capabilities: entry.capabilities });
    log('debug', `[AgentKernel] domain registered: ${domainId}`);
    return entry;
  }

  // ── Domain resolution ──────────────────────────────────────────────────────
  resolveDomain(intent) {
    if (!intent || !this.domains.size) return this.domains.size ? [...this.domains.values()][0] : null;

    // Caller passed explicit { domain: 'network' }
    if (typeof intent === 'object' && intent.domain) {
      const d = this.domains.get(intent.domain);
      if (d) return d;
    }

    const needle = (typeof intent === 'object' ? (intent.text || intent.action || '') : String(intent)).toLowerCase();

    // Domain id match
    for (const [id, entry] of this.domains)
      if (needle.includes(id)) return entry;

    // Capability keyword match
    for (const [, entry] of this.domains)
      if ((entry.capabilities || []).some((c) => needle.includes(c.toLowerCase()))) return entry;

    // First registered
    return [...this.domains.values()][0];
  }

  // ── Dispatch ───────────────────────────────────────────────────────────────
  async dispatch(agentConfig, context = {}) {
    if (!this._ready) this.init();
    const domain = this.resolveDomain(context.intent || context);
    if (!domain) throw new Error('No domain available for dispatch');

    const session = this._sessions.create({
      domain: domain.adapter.name || 'unknown',
      meta: { intent: context.intent },
    });

    this.emit('dispatch:start', { sessionId: session.id, domain: session.domain });
    try {
      this._sessions.transition(session.id, 'running');
      const result = typeof domain.adapter.execute === 'function'
        ? await domain.adapter.execute(context)
        : await domain.adapter.getSkills?.()[0]?.execute?.(context);
      this._sessions.transition(session.id, 'completed');
      this.emit('dispatch:done', { sessionId: session.id });
      return result;
    } catch (err) {
      try { this._sessions.transition(session.id, 'failed'); } catch (_) {}
      this.emit('dispatch:error', { sessionId: session.id, error: err.message });
      throw err;
    }
  }

  // ── Tool execution (backward compat with src/kernel.js callers) ───────────
  async execute(toolName, params = {}) {
    const domain = [...this.domains.values()][0];
    if (!domain) throw new Error('No domain registered — cannot execute tool');
    const skill = domain.adapter.getSkills?.().find((s) => s.name === toolName);
    if (!skill) throw new Error(`Tool not found: ${toolName}`);
    this.emit('command:run', { tool: toolName, params });
    const result = await skill.execute(params);
    this.emit('command:done', { tool: toolName, result });
    return result;
  }

  // ── Introspection ──────────────────────────────────────────────────────────
  status() {
    return {
      ready: this._ready,
      domains: [...this.domains.keys()],
      sdk: sdk.snapshot(),
    };
  }

  // ── getTools — for openclaw meta.js ───────────────────────────────────────
  getTools() {
    const out = {};
    for (const [, entry] of this.domains) {
      for (const skill of (entry.adapter.getSkills?.() || [])) {
        out[skill.name] = {
          description: skill.description || '',
          parameters:  skill.parameters  || {},
          risk:        skill.risk        || 'low',
        };
      }
    }
    return out;
  }
}

export default AgentKernel;
