'use strict';
/**
 * UserSandbox — AgentOS Authorization, RBAC, and Sandboxed Execution
 * ─────────────────────────────────────────────────────────────────────
 * Patterns drawn from:
 *   nanoclaw  → PermissionPolicy (tool allowlist, wildcard matching,
 *               requireApproval gates, rate-limit hooks)
 *   smartcomputer-ai/agentos → ContextualExecutor (per-user execution
 *               context, capability scoping, sandbox isolation)
 *
 * Execution modes:
 *   live    — real tools, real routers (admin / operator)
 *   sandbox — same tool interface, all mutations intercepted and
 *             logged but not applied (developer role)
 *   readonly — only GET-like tools permitted (viewer)
 *
 * Role definitions live in src/policies/roles.json. The users map in
 * that file is a fast local override for CLI operator identities; the
 * primary user store is database.js (Firestore / SQLite / in-memory).
 * ─────────────────────────────────────────────────────────────────────
 */

import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { logger } from './logger.js';

// ── load roles ────────────────────────────────────────────────────────────
let _roles = null;
function getRoles() {
  if (!_roles) {
    try {
      _roles = require(path.resolve(__dirname, '../policies/roles.json'));
    } catch (_) {
      _roles = { roles: {}, users: {} };
    }
  }
  return _roles;
}

// ── wildcard matching (nanoclaw pattern) ─────────────────────────────────
function toolMatches(pattern, toolName) {
  if (pattern === '*') return true;
  if (pattern === toolName) return true;
  if (pattern.endsWith('.*')) {
    const ns = pattern.slice(0, -2);
    return toolName === ns || toolName.startsWith(ns + '.');
  }
  return false;
}

function anyMatch(patterns, toolName) {
  return patterns.some(p => toolMatches(p, toolName));
}

// ── role resolution ───────────────────────────────────────────────────────
function getRole(roleName) {
  const { roles } = getRoles();
  return roles[roleName] || roles['user'];
}

function getRoleForUser(userId) {
  const { users } = getRoles();
  if (users && users[userId]) return getRole(users[userId].role || 'user');
  return null; // not a policy-file user — caller checks database
}

// ── AuthError ─────────────────────────────────────────────────────────────
class AuthError extends Error {
  constructor(message, code = 'FORBIDDEN') {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

// ── SandboxInterceptor (nanoclaw PermissionPolicy + smartcomputer context) ─
class SandboxInterceptor {
  constructor({ userId, role, routerId, db }) {
    this.userId = userId;
    this.role = role;
    this.routerId = routerId;
    this.db = db;
    this.isSandbox = role.sandbox === true;
    this.isReadOnly = !anyMatch(role.tools, 'voucher.create') &&
      !anyMatch(role.tools, 'user.kick') &&
      !anyMatch(role.tools, 'system.reboot');
    this.log = [];
  }

  /** Check if a tool can be called, throw AuthError if not */
  authorize(toolName) {
    const { tools, requireApproval } = this.role;

    if (!anyMatch(tools, toolName)) {
      throw new AuthError(
        `Role '${this.role.label || 'unknown'}' cannot call '${toolName}'`,
        'TOOL_NOT_ALLOWED'
      );
    }
    if (requireApproval.length > 0 && requireApproval[0] !== '' &&
        anyMatch(requireApproval, toolName)) {
      throw new AuthError(
        `'${toolName}' requires approval for role '${this.role.label}'`,
        'APPROVAL_REQUIRED'
      );
    }
  }

  /** Apply limits for a tool (e.g. maxDuration, maxBatch) */
  checkLimits(toolName, args) {
    const limits = (this.role.limits || {})[toolName] || {};
    if (limits.maxBatch && args.count > limits.maxBatch) {
      throw new AuthError(
        `Batch size ${args.count} exceeds limit ${limits.maxBatch} for role '${this.role.label}'`,
        'LIMIT_EXCEEDED'
      );
    }
    if (limits.maxDuration && args.duration && args.duration > limits.maxDuration) {
      throw new AuthError(
        `Duration '${args.duration}' exceeds max '${limits.maxDuration}' for role '${this.role.label}'`,
        'LIMIT_EXCEEDED'
      );
    }
  }

  /**
   * Wrap a tool executor. In sandbox mode all mutations are intercepted —
   * the executor is replaced with a no-op that returns a realistic stub,
   * and the call is recorded in this.log. Matching nanoclaw's DryRunPolicy.
   */
  wrap(toolName, executor) {
    return async (args, ctx) => {
      this.authorize(toolName);
      this.checkLimits(toolName, args || {});

      const entry = {
        id: crypto.randomUUID().slice(0, 8),
        ts: new Date().toISOString(),
        userId: this.userId,
        tool: toolName,
        args,
        sandbox: this.isSandbox
      };

      if (this.isSandbox) {
        const result = { sandbox: true, would_call: toolName, with: args, note: 'Sandbox — no changes applied' };
        this.log.push({ ...entry, result });
        logger.info(`[SANDBOX] ${this.userId} → ${toolName}`, args);
        return result;
      }

      try {
        const result = await executor(args, ctx);
        this.log.push({ ...entry, result, ok: true });
        return result;
      } catch (err) {
        this.log.push({ ...entry, error: err.message, ok: false });
        throw err;
      }
    };
  }

  getSandboxLog() { return this.log; }
}

// ── UserSandbox (main class) ───────────────────────────────────────────────
class UserSandbox extends EventEmitter {
  constructor({ db, approvalStore } = {}) {
    super();
    this.db = db || null;
    this.approvalStore = approvalStore || new Map();
    this._rateLimits = new Map(); // userId:tool → { count, resetAt }
  }

  // ── User CRUD (delegates to db, with role enforcement) ────────────────

  async getUser(userId) {
    if (!userId) return null;
    // 1. Check policy-file local override (CLI operators)
    const { users } = getRoles();
    if (users[userId]) return { ...users[userId], uid: userId, _source: 'policy' };
    // 2. Check database
    if (this.db) {
      const u = await this.db.getUser(userId).catch(() => null);
      if (u) return { ...u, _source: 'db' };
    }
    return null;
  }

  async getRole(userId, { fallbackRole } = {}) {
    const user = await this.getUser(userId);
    if (!user) return getRole(fallbackRole || 'user');
    return getRole(user.role || fallbackRole || 'user');
  }

  /** Resolve the effective role name string for a user (not the role object) */
  async getRoleName(userId) {
    const user = await this.getUser(userId);
    return user?.role || 'user';
  }

  async setRole(actorId, targetId, newRole) {
    const actorRole = await this.getRole(actorId);
    if (!actorRole.canManageRoles) {
      throw new AuthError(`You don't have permission to assign roles`, 'FORBIDDEN');
    }
    const { roles } = getRoles();
    if (!roles[newRole]) throw new AuthError(`Unknown role: ${newRole}`, 'INVALID_ROLE');

    if (this.db) {
      await this.db.upsertUser(targetId, { role: newRole });
    } else {
      const policy = getRoles();
      policy.users[targetId] = { ...(policy.users[targetId] || {}), role: newRole };
    }
    this.emit('roleChanged', { actorId, targetId, newRole });
    logger.info(`[UserSandbox] ${actorId} set ${targetId} role → ${newRole}`);
  }

  async listUsers({ role, limit = 50 } = {}) {
    if (this.db) {
      const rows = await this.db.listUsers?.({ role, limit }) || [];
      return rows;
    }
    const { users } = getRoles();
    return Object.entries(users)
      .filter(([, u]) => !role || u.role === role)
      .slice(0, limit)
      .map(([id, u]) => ({ uid: id, ...u }));
  }

  // ── Tool authorization ─────────────────────────────────────────────────

  async canUse(userId, toolName) {
    const role = await this.getRole(userId);
    return anyMatch(role.tools, toolName);
  }

  async needsApproval(userId, toolName) {
    const role = await this.getRole(userId);
    const { requireApproval = [] } = role;
    return requireApproval.length > 0 && anyMatch(requireApproval, toolName);
  }

  // ── Execution context (smartcomputer-ai pattern) ───────────────────────

  async createContext(userId, { routerId = null, fallbackRole = 'user' } = {}) {
    const role = await this.getRole(userId, { fallbackRole });
    const user = await this.getUser(userId);
    return new SandboxInterceptor({ userId, role, routerId, db: this.db, user });
  }

  /**
   * The main execution gate — used by AICoordinator and channel handlers.
   * nanoclaw-style: authorize → (approval gate) → (rate-limit) → execute
   * ctx.fallbackRole lets channels grant unprovisioned users a default access level
   * (e.g. a Telegram bot with defaultRole:'operator' so operators aren't auto-blocked).
   */
  async execute(userId, toolName, args, executor, ctx = {}) {
    const role = await this.getRole(userId, { fallbackRole: ctx.fallbackRole || 'user' });
    const interceptor = new SandboxInterceptor({ userId, role, routerId: ctx.routerId, db: this.db });
    const wrapped = interceptor.wrap(toolName, executor);
    return wrapped(args, ctx);
  }

  // ── Approval flow ──────────────────────────────────────────────────────

  async requestApproval({ userId, toolName, args, routerId }) {
    const id = `appr-${crypto.randomUUID().slice(0, 8)}`;
    const req = {
      id,
      userId,
      toolName,
      args,
      routerId,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    this.approvalStore.set(id, req);
    this.emit('approvalRequested', req);
    logger.info(`[UserSandbox] Approval requested: ${id} — ${userId} → ${toolName}`);
    return req;
  }

  async resolveApproval(approvalId, { approved, resolvedBy }) {
    const req = this.approvalStore.get(approvalId);
    if (!req) throw new Error(`Approval ${approvalId} not found`);
    req.status = approved ? 'approved' : 'denied';
    req.resolvedBy = resolvedBy;
    req.resolvedAt = new Date().toISOString();
    this.approvalStore.set(approvalId, req);
    this.emit('approvalResolved', req);
    return req;
  }

  listPendingApprovals() {
    return [...this.approvalStore.values()].filter(r => r.status === 'pending');
  }

  // ── Rate limiting (nanoclaw RequestThrottle pattern) ──────────────────

  checkRateLimit(userId, toolName, { windowMs = 60_000, max = 30 } = {}) {
    const key = `${userId}:${toolName}`;
    const now = Date.now();
    let slot = this._rateLimits.get(key);
    if (!slot || now > slot.resetAt) {
      slot = { count: 0, resetAt: now + windowMs };
      this._rateLimits.set(key, slot);
    }
    slot.count++;
    if (slot.count > max) {
      throw new AuthError(
        `Rate limit exceeded for '${toolName}' (${max}/${windowMs}ms)`,
        'RATE_LIMITED'
      );
    }
    return { remaining: max - slot.count, resetAt: slot.resetAt };
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────
let _instance = null;
function getUserSandbox(opts) {
  if (!_instance || opts) _instance = new UserSandbox(opts || {});
  return _instance;
}

export default { UserSandbox, getUserSandbox, AuthError, SandboxInterceptor, getRole, getRoleForUser, anyMatch, toolMatches };
