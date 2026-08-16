import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getSQLite } from './sqlite-db.js';
import { validateWorkPackage } from './wbs-work-packages.js';

function scopeOf(input = {}) {
  return {
    tenantId: input.tenantId || input.scope?.tenantId || null,
    siteId: input.siteId || input.scope?.siteId || null,
    domain: input.domain || input.scope?.domain || 'general',
    projectId: input.projectId || input.scope?.projectId || null,
    userId: input.userId || input.ownerUserId || null
  };
}

function requireTenant(scope) {
  if (!scope.tenantId) throw new Error('tenantId is required for WBS persistence');
}

function scoped(row, scope, { requireProject = false } = {}) {
  requireTenant(scope);
  if (row.tenantId !== scope.tenantId) return false;
  if (scope.siteId && row.siteId !== scope.siteId) return false;
  if (scope.domain && row.domain !== scope.domain) return false;
  if (requireProject && scope.projectId && row.projectId !== scope.projectId) return false;
  return true;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export class WbsService {
  constructor({ db = null, forceFile = false, fallbackPath = process.env.AGENTOS_WBS_FALLBACK_PATH || path.join(process.cwd(), 'state', 'wbs-store.json'), now = () => new Date().toISOString() } = {}) {
    this.db = db;
    this.forceFile = forceFile;
    this.fallbackPath = fallbackPath;
    this.now = now;
    this.mode = db ? 'sqlite' : null;
    this.fallback = { packages: {}, projects: {}, handoffs: {} };
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return this;
    if (this.forceFile) {
      this.mode = 'file';
    } else if (!this.db) {
      try {
        this.db = await getSQLite();
        this.mode = 'sqlite';
      } catch {
        this.mode = 'file';
      }
    }
    if (this.mode === 'sqlite') {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS agentos_projects (
          projectId TEXT PRIMARY KEY,
          tenantId TEXT NOT NULL,
          siteId TEXT,
          domain TEXT NOT NULL,
          name TEXT NOT NULL,
          status TEXT NOT NULL,
          ownerUserId TEXT NOT NULL,
          metadata TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agentos_projects_scope ON agentos_projects (tenantId, siteId, domain);
        CREATE TABLE IF NOT EXISTS agentos_wbs_packages (
          wbsId TEXT PRIMARY KEY,
          projectId TEXT,
          tenantId TEXT NOT NULL,
          siteId TEXT,
          domain TEXT NOT NULL,
          agentRole TEXT NOT NULL,
          ownerUserId TEXT,
          title TEXT NOT NULL,
          objective TEXT NOT NULL,
          status TEXT NOT NULL,
          payload TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agentos_wbs_scope ON agentos_wbs_packages (tenantId, siteId, domain, projectId);
        CREATE TABLE IF NOT EXISTS agentos_wbs_handoffs (
          handoffId TEXT PRIMARY KEY,
          projectId TEXT,
          wbsId TEXT,
          tenantId TEXT NOT NULL,
          siteId TEXT,
          domain TEXT NOT NULL,
          fromRole TEXT NOT NULL,
          toRole TEXT NOT NULL,
          fromUserId TEXT,
          toUserId TEXT,
          status TEXT NOT NULL,
          payload TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agentos_handoff_scope ON agentos_wbs_handoffs (tenantId, siteId, domain, projectId);
      `);
    } else {
      await this._loadFallback();
    }
    this.initialized = true;
    return this;
  }

  async _loadFallback() {
    try {
      this.fallback = JSON.parse(await fs.readFile(this.fallbackPath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async _saveFallback() {
    await fs.mkdir(path.dirname(this.fallbackPath), { recursive: true });
    const temporary = `${this.fallbackPath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(this.fallback, null, 2), 'utf8');
    await fs.rename(temporary, this.fallbackPath);
  }

  _assertPackageScope(item, scope) {
    if (!scoped(item, scope)) throw new Error('WBS package is outside the authorized execution scope');
  }

  async createProject(input = {}) {
    await this.init();
    const scope = scopeOf(input);
    requireTenant(scope);
    if (!scope.userId) throw new Error('userId is required to create a project');
    const project = {
      projectId: input.projectId || `project_${crypto.randomUUID()}`,
      tenantId: scope.tenantId,
      siteId: scope.siteId,
      domain: scope.domain,
      name: input.name || 'AgentOS Project',
      status: input.status || 'active',
      ownerUserId: scope.userId,
      metadata: clone(input.metadata || {}),
      createdAt: this.now(),
      updatedAt: this.now()
    };
    if (this.mode === 'sqlite') {
      this.db.prepare(`INSERT INTO agentos_projects (projectId, tenantId, siteId, domain, name, status, ownerUserId, metadata, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(project.projectId, project.tenantId, project.siteId, project.domain, project.name, project.status, project.ownerUserId, JSON.stringify(project.metadata), project.createdAt, project.updatedAt);
    } else {
      this.fallback.projects[project.projectId] = project;
      await this._saveFallback();
    }
    return clone(project);
  }

  async listProjects(scopeInput = {}) {
    await this.init();
    const scope = scopeOf(scopeInput);
    requireTenant(scope);
    if (this.mode === 'sqlite') {
      const rows = this.db.prepare('SELECT * FROM agentos_projects WHERE tenantId = ? AND (? IS NULL OR siteId = ?) AND (? IS NULL OR domain = ?) ORDER BY updatedAt DESC').all(scope.tenantId, scope.siteId, scope.siteId, scope.domain, scope.domain);
      return rows.map((row) => ({ ...row, metadata: JSON.parse(row.metadata || '{}') }));
    }
    return Object.values(this.fallback.projects).filter((item) => scoped(item, scope)).map(clone);
  }

  async savePackages(packages = [], scopeInput = {}) {
    await this.init();
    const scope = scopeOf(scopeInput);
    requireTenant(scope);
    if (!Array.isArray(packages)) throw new Error('packages must be an array');
    const items = packages.map((item) => {
      const candidate = { ...item, tenantId: item.tenantId || scope.tenantId, siteId: item.siteId || scope.siteId, domain: item.domain || scope.domain, ownerUserId: item.ownerUserId || scope.userId, updatedAt: this.now(), createdAt: item.createdAt || this.now() };
      const validation = validateWorkPackage(candidate);
      if (!validation.valid) throw new Error(`Invalid WBS package ${candidate.wbsId}: ${validation.errors.join(', ')}`);
      this._assertPackageScope(candidate, scope);
      return candidate;
    });
    if (this.mode === 'sqlite') {
      const insert = this.db.prepare(`INSERT OR REPLACE INTO agentos_wbs_packages (wbsId, projectId, tenantId, siteId, domain, agentRole, ownerUserId, title, objective, status, payload, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const transaction = this.db.transaction((rows) => rows.forEach((item) => insert.run(item.wbsId, item.projectId, item.tenantId, item.siteId, item.domain, item.agentRole, item.ownerUserId, item.title, item.objective, item.status, JSON.stringify(item), item.createdAt, item.updatedAt)));
      transaction(items);
    } else {
      for (const item of items) this.fallback.packages[item.wbsId] = item;
      await this._saveFallback();
    }
    return items.map(clone);
  }

  async listPackages(scopeInput = {}) {
    await this.init();
    const scope = scopeOf(scopeInput);
    requireTenant(scope);
    if (this.mode === 'sqlite') {
      const rows = this.db.prepare('SELECT payload FROM agentos_wbs_packages WHERE tenantId = ? AND (? IS NULL OR siteId = ?) AND (? IS NULL OR domain = ?) AND (? IS NULL OR projectId = ?) ORDER BY createdAt ASC').all(scope.tenantId, scope.siteId, scope.siteId, scope.domain, scope.domain, scope.projectId, scope.projectId);
      return rows.map((row) => JSON.parse(row.payload));
    }
    return Object.values(this.fallback.packages).filter((item) => scoped(item, scope, { requireProject: true })).map(clone);
  }

  async updatePackage(wbsId, patch = {}, scopeInput = {}) {
    await this.init();
    const scope = scopeOf(scopeInput);
    requireTenant(scope);
    const current = (await this.listPackages({ ...scope, projectId: null })).find((item) => item.wbsId === wbsId);
    if (!current) return null;
    this._assertPackageScope(current, scope);
    const next = { ...current, ...clone(patch), wbsId: current.wbsId, tenantId: current.tenantId, siteId: current.siteId, domain: current.domain, updatedAt: this.now() };
    const validation = validateWorkPackage(next);
    if (!validation.valid) throw new Error(`Invalid WBS package ${wbsId}: ${validation.errors.join(', ')}`);
    if (this.mode === 'sqlite') {
      this.db.prepare('UPDATE agentos_wbs_packages SET status = ?, payload = ?, updatedAt = ? WHERE wbsId = ? AND tenantId = ?').run(next.status, JSON.stringify(next), next.updatedAt, wbsId, scope.tenantId);
    } else {
      this.fallback.packages[wbsId] = next;
      await this._saveFallback();
    }
    return clone(next);
  }

  async createHandoff(input = {}) {
    await this.init();
    const scope = scopeOf(input);
    requireTenant(scope);
    if (!scope.userId) throw new Error('userId is required to create a handoff');
    if (!input.fromRole || !input.toRole || !input.wbsId) throw new Error('fromRole, toRole, and wbsId are required');
    const handoff = { handoffId: input.handoffId || `handoff_${crypto.randomUUID()}`, projectId: scope.projectId, wbsId: input.wbsId, tenantId: scope.tenantId, siteId: scope.siteId, domain: scope.domain, fromRole: input.fromRole, toRole: input.toRole, fromUserId: scope.userId, toUserId: input.toUserId || null, status: 'pending', payload: clone(input.payload || {}), createdAt: this.now(), updatedAt: this.now() };
    if (this.mode === 'sqlite') {
      this.db.prepare('INSERT INTO agentos_wbs_handoffs (handoffId, projectId, wbsId, tenantId, siteId, domain, fromRole, toRole, fromUserId, toUserId, status, payload, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(handoff.handoffId, handoff.projectId, handoff.wbsId, handoff.tenantId, handoff.siteId, handoff.domain, handoff.fromRole, handoff.toRole, handoff.fromUserId, handoff.toUserId, handoff.status, JSON.stringify(handoff.payload), handoff.createdAt, handoff.updatedAt);
    } else {
      this.fallback.handoffs[handoff.handoffId] = handoff;
      await this._saveFallback();
    }
    return clone(handoff);
  }

  async listHandoffs(scopeInput = {}) {
    await this.init();
    const scope = scopeOf(scopeInput);
    requireTenant(scope);
    if (this.mode === 'sqlite') {
      const rows = this.db.prepare('SELECT * FROM agentos_wbs_handoffs WHERE tenantId = ? AND (? IS NULL OR siteId = ?) AND (? IS NULL OR domain = ?) AND (? IS NULL OR projectId = ?) ORDER BY createdAt DESC').all(scope.tenantId, scope.siteId, scope.siteId, scope.domain, scope.domain, scope.projectId, scope.projectId);
      return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload || '{}') }));
    }
    return Object.values(this.fallback.handoffs).filter((item) => scoped(item, scope, { requireProject: true })).map(clone);
  }
}

export default { WbsService, scopeOf };
