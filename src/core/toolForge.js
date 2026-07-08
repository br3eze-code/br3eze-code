'use strict';
const crypto = require('crypto');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { logger } = require('./logger');

const FORGE_DIR = process.env.TOOLFORGE_DIR
  || path.join(process.env.AGENTOS_STATE_PATH || path.join(process.cwd(), 'data'), 'toolforge');

const MAX_CODE_BYTES   = 64_000;
const VM_TIMEOUT_MS    = 8_000;
const MAX_TOOL_NAME    = 64;
const TOOL_NAME_RE     = /^[a-zA-Z0-9_.\-]+$/;

const STATUS = Object.freeze({
  DRAFT: 'draft', REVIEW: 'review', APPROVED: 'approved',
  SHADOW: 'shadow', ACTIVE: 'active', REJECTED: 'rejected', REVOKED: 'revoked',
});

const CAPABILITY = Object.freeze({
  FETCH: 'fetch', FS_READ: 'fs.read', FS_WRITE: 'fs.write',
  EXEC: 'exec', DB: 'db', MIKROTIK: 'mikrotik',
});

function sha256(str) {
  return 'sha256:' + crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function validateToolName(name) {
  if (!name || name.length > MAX_TOOL_NAME || !TOOL_NAME_RE.test(name))
    throw new Error(`Invalid tool name '${name}'`);
}

function validateCode(code) {
  if (!code || typeof code !== 'string') throw new Error('code must be a non-empty string');
  if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) throw new Error(`code exceeds ${MAX_CODE_BYTES} byte limit`);
  const BANNED = [/\brequire\s*\(/, /process\s*\.\s*exit/, /global\s*\./, /__proto__/, /constructor\s*\[/];
  for (const re of BANNED) if (re.test(code)) throw new Error(`Forbidden pattern in code: ${re}`);
  try { new vm.Script(code); } catch (e) { throw new Error(`Syntax error: ${e.message}`); }
}

// ── ToolSpec ──────────────────────────────────────────────────────────────
class ToolSpec {
  constructor({ toolId, toolName, description, paramsSchema, code, capabilities = [], author, requireApproval = true }) {
    validateToolName(toolName);
    this.toolId = toolId || `forge.${toolName.replace(/\./g,'_')}`;
    this.toolName = toolName;
    this.description = description;
    this.paramsSchema = paramsSchema || { type: 'object', properties: {}, required: [] };
    this.code = code;
    this.capabilities = capabilities;
    this.author = author || 'agent';
    this.requireApproval = requireApproval;
    // Integrity hash — matches smartcomputer-ai tool_ref SHA-256 pattern
    this.toolRef = sha256(JSON.stringify({ toolName, description, paramsSchema, code }));
    this.createdAt = new Date().toISOString();
  }

  toLLMDeclaration() {
    return {
      name: this.toolName.replace(/\./g, '__'),
      description: this.description,
      parameters: this.paramsSchema,
    };
  }
}

// ── VMSandbox — rivet-dev isolation pattern ───────────────────────────────
class VMSandbox {
  static buildContext(spec, { db, mikrotik } = {}) {
    const wsDir = path.join(FORGE_DIR, 'workspace');
    const ctx = {
      console: {
        log:   (...a) => logger.debug(`[forge:${spec.toolName}]`, ...a),
        warn:  (...a) => logger.warn(`[forge:${spec.toolName}]`, ...a),
        error: (...a) => logger.error(`[forge:${spec.toolName}]`, ...a),
      },
      // ── Core JS builtins — must be explicitly whitelisted in vm.createContext ──
      // Without these, even basic operations like filter(Boolean), new Map(),
      // Array.from(), parseInt(), etc. silently fail or return wrong results.
      JSON, Math, Date, Promise,
      parseInt, parseFloat, isNaN, isFinite,
      encodeURIComponent, decodeURIComponent,
      // Type constructors and built-in classes
      Boolean, Number, String, Array, Object, Symbol, BigInt,
      RegExp, Error, TypeError, RangeError, SyntaxError,
      // Collections
      Map, Set, WeakMap, WeakSet,
      // Array helpers
      ArrayBuffer, Uint8Array, Int32Array, Float64Array,
      // Structured cloning / serialization
      structuredClone: typeof structuredClone !== 'undefined' ? structuredClone : (v) => JSON.parse(JSON.stringify(v)),
      // Text codec
      TextEncoder: typeof TextEncoder !== 'undefined' ? TextEncoder : undefined,
      TextDecoder: typeof TextDecoder !== 'undefined' ? TextDecoder : undefined,
      // Crypto (non-sensitive — random UUIDs, hashing)
      crypto: { randomUUID: () => require('crypto').randomUUID() },
      // Timing (read-only — no side effects)
      performance: { now: () => require('perf_hooks').performance.now() },
    };

    if (spec.capabilities.includes(CAPABILITY.FETCH)) {
      ctx.fetch = (url, opts) => {
        const u = String(url);
        if (/^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u))
          return Promise.reject(new Error(`SSRF blocked: ${u}`));
        return global.fetch(url, opts);
      };
    }

    if (spec.capabilities.includes(CAPABILITY.FS_READ)) {
      ctx.readFile = (rel) => {
        const abs = path.resolve(wsDir, rel);
        if (!abs.startsWith(wsDir)) throw new Error('Path traversal blocked');
        return fs.promises.readFile(abs, 'utf8');
      };
      ctx.listDir = (rel = '.') => {
        const abs = path.resolve(wsDir, rel);
        if (!abs.startsWith(wsDir)) throw new Error('Path traversal blocked');
        return fs.promises.readdir(abs);
      };
    }

    if (spec.capabilities.includes(CAPABILITY.FS_WRITE)) {
      ctx.writeFile = (rel, content) => {
        const abs = path.resolve(wsDir, rel);
        if (!abs.startsWith(wsDir)) throw new Error('Path traversal blocked');
        return fs.promises.writeFile(abs, content, 'utf8');
      };
    }

    if (spec.capabilities.includes(CAPABILITY.DB) && db) {
      ctx.db = {
        getUser: (id) => db.getUser?.(id) || Promise.reject(new Error('db.getUser not available')),
        listVouchers: (opts) => db.listVouchers?.(opts) || Promise.reject(new Error('not available')),
      };
    }

    if (spec.capabilities.includes(CAPABILITY.MIKROTIK) && mikrotik) {
      ctx.mikrotik = { executeTool: (n, p, c) => mikrotik.executeTool(n, p, c || {}) };
    }

    return vm.createContext(ctx);
  }

  static async execute(spec, args, deps = {}) {
    const sandboxCtx = VMSandbox.buildContext(spec, deps);
    const wrapped = `(async () => {
${spec.code}
if (typeof run !== 'function') throw new Error("Tool must define: async function run(args) {...}");
__forge_result = await run(${JSON.stringify(args || {})});
})().then(() => {}, err => { __forge_error = err.message; });`;

    sandboxCtx.__forge_result = undefined;
    sandboxCtx.__forge_error = undefined;

    const script = new vm.Script(wrapped, { filename: `forge:${spec.toolId}` });
    const startMs = Date.now();

    const promise = script.runInContext(sandboxCtx, { timeout: VM_TIMEOUT_MS });

    // Wait for the async IIFE to complete, with a wall-clock timeout
    await Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(
        () => rej(new Error(`Tool '${spec.toolName}' timed out after ${VM_TIMEOUT_MS}ms`)),
        VM_TIMEOUT_MS
      ))
    ]);

    if (sandboxCtx.__forge_error) throw new Error(`[${spec.toolName}] ${sandboxCtx.__forge_error}`);
    return { result: sandboxCtx.__forge_result, durationMs: Date.now() - startMs };
  }
}

// ── ToolProposal ──────────────────────────────────────────────────────────
class ToolProposal {
  constructor(spec, { proposedBy, reason } = {}) {
    this.id = `prop-${crypto.randomUUID().slice(0, 8)}`;
    this.spec = spec;
    this.status = spec.requireApproval ? STATUS.REVIEW : STATUS.APPROVED;
    this.proposedBy = proposedBy || 'agent';
    this.reason = reason || '';
    this.proposedAt = new Date().toISOString();
    this.reviewedBy = null; this.reviewedAt = null;
    this.activeAt = null;
    this.shadowRuns = []; this.receipts = [];
  }

  approve(by) {
    if (this.status !== STATUS.REVIEW) throw new Error(`Cannot approve in status '${this.status}'`);
    this.status = STATUS.APPROVED; this.reviewedBy = by; this.reviewedAt = new Date().toISOString();
  }
  reject(by, reason) {
    this.status = STATUS.REJECTED; this.reviewedBy = by;
    this.reviewedAt = new Date().toISOString(); this.reason = reason || this.reason;
  }
  activate() {
    if (![STATUS.APPROVED, STATUS.SHADOW].includes(this.status))
      throw new Error(`Cannot activate in status '${this.status}'`);
    this.status = STATUS.ACTIVE; this.activeAt = new Date().toISOString();
  }
  addReceipt(r) { this.receipts.push(r); }

  toSummary() {
    return {
      id: this.id, toolId: this.spec.toolId, toolName: this.spec.toolName,
      toolRef: this.spec.toolRef, status: this.status, proposedBy: this.proposedBy,
      proposedAt: this.proposedAt, reviewedBy: this.reviewedBy, activeAt: this.activeAt,
      shadowRuns: this.shadowRuns.length, receipts: this.receipts.length,
    };
  }
}

// ── ToolForge ─────────────────────────────────────────────────────────────
class ToolForge extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.skillRegistry = opts.skillRegistry || null;
    this.db = opts.db || null;
    this.mikrotik = opts.mikrotik || null;
    this.autoApprove = opts.autoApprove === true;
    this._proposals = new Map();
    this._active = new Map();
    this._receipts = [];
    fs.mkdirSync(FORGE_DIR, { recursive: true });
    fs.mkdirSync(path.join(FORGE_DIR, 'workspace'), { recursive: true });
    this._loadFromDisk();
  }

  // ── Propose (agent writes a new tool) ─────────────────────────────────
  async propose({ toolName, description, paramsSchema, code, capabilities = [], author, proposedBy, reason, requireApproval }) {
    validateCode(code);
    const spec = new ToolSpec({
      toolName, description, paramsSchema, code, capabilities,
      author: author || proposedBy || 'agent',
      requireApproval: requireApproval !== false && !this.autoApprove,
    });

    // Deduplicate by toolRef
    for (const [, { spec: ex }] of this._active) {
      if (ex.toolRef === spec.toolRef) return ex.toolId;
    }

    const proposal = new ToolProposal(spec, { proposedBy, reason });
    this._proposals.set(proposal.id, proposal);
    this.emit('proposed', proposal.toSummary());
    logger.info(`[ToolForge] Proposed '${toolName}' (#${proposal.id}) status=${proposal.status}`);

    if (proposal.status === STATUS.APPROVED) {
      await this._shadowRun(proposal);
      this._activate(proposal);
    }

    this._saveToDisk();
    return proposal.id;
  }

  // ── Review ────────────────────────────────────────────────────────────
  approve(proposalId, { by = 'admin' } = {}) {
    const p = this._getProposal(proposalId);
    p.approve(by);
    this.emit('approved', p.toSummary());
    this._shadowRun(p).then(() => { this._activate(p); this._saveToDisk(); })
      .catch(err => {
        p.status = STATUS.REVIEW;
        this.emit('shadowFailed', { proposalId, error: err.message });
      });
    return p.toSummary();
  }

  reject(proposalId, { by = 'admin', reason = '' } = {}) {
    const p = this._getProposal(proposalId);
    p.reject(by, reason);
    this.emit('rejected', p.toSummary());
    this._saveToDisk();
    return p.toSummary();
  }

  revoke(toolId, { by = 'admin' } = {}) {
    const entry = this._active.get(toolId);
    if (!entry) throw new Error(`No active tool: ${toolId}`);
    entry.proposal.status = STATUS.REVOKED;
    this._active.delete(toolId);
    if (this.skillRegistry) {
      ['skills', 'manifests', 'implementations'].forEach(m => this.skillRegistry[m]?.delete(toolId));
    }
    this._saveToDisk();
    this.emit('revoked', { toolId, by });
    logger.info(`[ToolForge] Revoked '${toolId}' by ${by}`);
  }

  // ── Execute ───────────────────────────────────────────────────────────
  async execute(toolId, args = {}, context = {}) {
    const entry = this._active.get(toolId);
    if (!entry) throw new Error(`Tool '${toolId}' is not active`);
    const { spec, proposal } = entry;

    const receipt = {
      receiptId: `rcpt-${crypto.randomUUID().slice(0, 8)}`,
      toolId, toolRef: spec.toolRef, proposalId: proposal.id,
      userId: context.userId || 'system', args,
      startedAt: new Date().toISOString(),
      ok: false, result: null, error: null, durationMs: 0,
    };

    try {
      const { result, durationMs } = await VMSandbox.execute(spec, args, { db: this.db, mikrotik: this.mikrotik });
      receipt.ok = true; receipt.result = result; receipt.durationMs = durationMs;
    } catch (err) {
      receipt.error = err.message;
      receipt.durationMs = Date.now() - new Date(receipt.startedAt).getTime();
    }

    receipt.completedAt = new Date().toISOString();
    proposal.addReceipt(receipt);
    this._receipts.push(receipt);
    this.emit('receipt', receipt);
    if (!receipt.ok) throw new Error(receipt.error);
    return receipt.result;
  }

  // ── Self-amend ────────────────────────────────────────────────────────
  async amend(toolId, { code, description, proposedBy, reason } = {}) {
    const entry = this._active.get(toolId);
    if (!entry) throw new Error(`No active tool: ${toolId}`);
    const old = entry.spec;
    return this.propose({ toolName: old.toolName, description: description || old.description,
      paramsSchema: old.paramsSchema, code: code || old.code, capabilities: old.capabilities,
      author: proposedBy || old.author, proposedBy, reason: reason || `Amending ${toolId}` });
  }

  // ── Query ─────────────────────────────────────────────────────────────
  listProposals(filter = {}) {
    let list = [...this._proposals.values()];
    if (filter.status) list = list.filter(p => p.status === filter.status);
    return list.map(p => p.toSummary());
  }
  listActive() {
    return [...this._active.entries()].map(([toolId, { spec, proposal }]) => ({
      toolId, toolName: spec.toolName, description: spec.description,
      toolRef: spec.toolRef, capabilities: spec.capabilities, author: spec.author,
      activeAt: proposal.activeAt, receipts: proposal.receipts.length,
    }));
  }
  listReceipts(limit = 50) { return this._receipts.slice(-limit); }
  getProposalDetail(id) {
    const p = this._proposals.get(id);
    if (!p) return null;
    return { ...p.toSummary(), spec: { ...p.spec }, shadowRuns: p.shadowRuns };
  }

  // ── Internals ─────────────────────────────────────────────────────────
  async _shadowRun(proposal) {
    proposal.status = STATUS.SHADOW;
    let sr;
    try {
      const { result, durationMs } = await VMSandbox.execute(proposal.spec, {}, { db: this.db, mikrotik: this.mikrotik });
      sr = { ok: true, durationMs, result };
    } catch (err) {
      sr = { ok: false, error: err.message };
      logger.warn(`[ToolForge] Shadow warning '${proposal.spec.toolName}': ${err.message}`);
    }
    proposal.shadowRuns.push({ ts: new Date().toISOString(), ...sr });
    this.emit('shadowRun', { proposalId: proposal.id, ...sr });
  }

  _activate(proposal) {
    const { spec } = proposal;
    proposal.activate();
    this._active.set(spec.toolId, { spec, proposal });

    if (this.skillRegistry) {
      const manifest = { name: spec.toolId, version: '1.0.0', description: spec.description,
        tools: { [spec.toolName]: { description: spec.description, parameters: spec.paramsSchema } } };
      const forge = this;
      this.skillRegistry.skills.set(spec.toolId, {
        manifest, validate: () => true,
        execute: (tn, args, ctx) => forge.execute(spec.toolId, args, ctx || {}),
      });
      this.skillRegistry.manifests.set(spec.toolId, manifest);
      this.skillRegistry.implementations?.set(spec.toolId, {
        getTools: () => ({ [spec.toolName]: { description: spec.description, parameters: spec.paramsSchema } }),
      });
    }

    logger.info(`[ToolForge] ✅ ACTIVE '${spec.toolName}' (${spec.toolId}) toolRef=${spec.toolRef}`);
    this.emit('activated', { toolId: spec.toolId, toolRef: spec.toolRef });
  }

  _getProposal(id) {
    const p = this._proposals.get(id);
    if (!p) throw new Error(`Proposal not found: ${id}`);
    return p;
  }

  _saveToDisk() {
    try {
      const state = { proposals: [...this._proposals.values()].map(p => ({
        id: p.id, status: p.status, proposedBy: p.proposedBy, proposedAt: p.proposedAt,
        reviewedBy: p.reviewedBy, reviewedAt: p.reviewedAt, activeAt: p.activeAt,
        reason: p.reason, shadowRuns: p.shadowRuns, spec: p.spec,
      })) };
      fs.writeFileSync(path.join(FORGE_DIR, 'state.json'), JSON.stringify(state, null, 2));
    } catch (err) { logger.warn('[ToolForge] Save failed:', err.message); }
  }

  _loadFromDisk() {
    const sf = path.join(FORGE_DIR, 'state.json');
    if (!fs.existsSync(sf)) return;
    try {
      const { proposals = [] } = JSON.parse(fs.readFileSync(sf, 'utf8'));
      let n = 0;
      for (const e of proposals) {
        if (e.status !== STATUS.ACTIVE) continue;
        try {
          const spec = Object.assign(new ToolSpec(e.spec), e.spec);
          const p = Object.assign(new ToolProposal(spec, { proposedBy: e.proposedBy }), {
            id: e.id, status: STATUS.APPROVED, reviewedBy: e.reviewedBy,
            reviewedAt: e.reviewedAt, activeAt: e.activeAt, shadowRuns: e.shadowRuns || [],
          });
          this._proposals.set(e.id, p);
          this._activate(p); n++;
        } catch (ex) { logger.warn(`[ToolForge] Skip corrupt entry ${e.id}: ${ex.message}`); }
      }
      if (n) logger.info(`[ToolForge] Reactivated ${n} persisted tool(s)`);
    } catch (err) { logger.warn('[ToolForge] Load failed:', err.message); }
  }
}

let _instance = null;
function getToolForge(opts) {
  if (!_instance || opts) _instance = new ToolForge(opts || {});
  return _instance;
}

module.exports = { ToolForge, getToolForge, ToolSpec, VMSandbox, STATUS, CAPABILITY, sha256 };
