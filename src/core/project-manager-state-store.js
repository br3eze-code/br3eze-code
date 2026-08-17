import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export class ProjectManagerStateStore {
  constructor(filePath = process.env.AGENTOS_PM_STATE_FILE || path.join(os.homedir(), '.agentos', 'project-manager-state.json')) {
    this.filePath = filePath;
    this.state = { sessions: {}, projects: {}, packages: {}, handoffs: {}, approvals: {} };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) this.state = { ...this.state, ...JSON.parse(fs.readFileSync(this.filePath, 'utf8')) };
    } catch (error) {
      throw new Error(`Unable to load Project Manager state: ${error.message}`);
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2));
    fs.renameSync(temporary, this.filePath);
  }

  getSession(id) { return this.state.sessions[id] || null; }
  saveSession(session) { this.state.sessions[session.sessionId] = { ...this.getSession(session.sessionId), ...session, updatedAt: new Date().toISOString() }; this._save(); return this.state.sessions[session.sessionId]; }

  saveProject(project) { this.state.projects[project.projectId] = { ...this.state.projects[project.projectId], ...project, updatedAt: new Date().toISOString() }; this._save(); return this.state.projects[project.projectId]; }
  getProject(projectId, tenantId) { const project = this.state.projects[projectId]; return project?.tenantId === tenantId ? project : null; }

  savePackage(pkg) { this.state.packages[pkg.packageId] = { ...this.state.packages[pkg.packageId], ...pkg, updatedAt: new Date().toISOString() }; this._save(); return this.state.packages[pkg.packageId]; }
  listPackages(projectId, tenantId) { return Object.values(this.state.packages).filter(p => p.projectId === projectId && p.tenantId === tenantId); }

  saveHandoff(handoff) { this.state.handoffs[handoff.handoffId] = handoff; this._save(); return handoff; }
  getHandoff(handoffId, tenantId) { const handoff = this.state.handoffs[handoffId]; return handoff?.tenantId === tenantId ? handoff : null; }

  saveApproval(approval) { this.state.approvals[approval.approvalId] = approval; this._save(); return approval; }
  getApproval(approvalId, tenantId) { const approval = this.state.approvals[approvalId]; return approval?.tenantId === tenantId ? approval : null; }
}

export class MemoryProjectManagerStateStore extends ProjectManagerStateStore {
  constructor() { super(path.join(os.tmpdir(), `agentos-pm-${process.pid}-${Date.now()}.json`)); }
  _load() { this.state = { sessions: {}, projects: {}, packages: {}, handoffs: {}, approvals: {} }; }
  _save() {}
}
