import { randomUUID } from 'node:crypto';

/**
 * Domain-neutral multi-tenant workspace.
 * Concrete AI, billing, persistence and adapter services are injected by the
 * host; Core never imports a product/domain implementation.
 */
class Workspace {
  constructor(config = {}) {
    this.id = config.id || randomUUID();
    this.name = config.name || this.id;
    this.domain = config.domain || 'generic';
    this.owner = config.owner || null;
    this.members = new Map(Object.entries(config.members || {}));
    this.resources = new Set(config.resources || []);
    this.adapters = new Map();
    this.config = config.settings || {};
    this.services = config.services || {};
    this.policy = config.policy || null;
    this.commandExecutor = config.commandExecutor || null;
  }

  async initialize(pluginRegistry = null) {
    const registry = pluginRegistry || this.services.pluginRegistry;
    for (const adapterConfig of this.config.adapters || []) {
      if (!registry?.load) throw new Error('No adapter registry configured');
      const adapter = await registry.load(adapterConfig.type, adapterConfig);
      this.adapters.set(adapterConfig.type, adapter);
    }
    return this;
  }

  registerAdapter(name, adapter) {
    if (!name || !adapter) throw new TypeError('Adapter name and instance are required');
    this.adapters.set(name, adapter);
    return adapter;
  }

  async executeCommand(userId, command, params = {}) {
    if (!this.canExecute(userId, command)) throw new Error('Unauthorized');
    if (typeof this.commandExecutor !== 'function') throw new Error('No workspace command executor configured');
    return this.commandExecutor(command, { userId, workspace: this.id, ...params });
  }

  canExecute(userId, command) {
    const role = this.members.get(userId);
    if (!role) return false;
    if (this.policy?.authorize) return Boolean(this.policy.authorize({ userId, role, command, workspace: this }));
    const permissions = {
      owner: ['*'], admin: ['resource.*', 'billing.*', 'user.*'],
      operator: ['resource.read', 'resource.execute'], viewer: ['resource.read']
    };
    const allowed = permissions[role] || [];
    return allowed.includes('*') || allowed.some(permission => command.startsWith(permission.replace('*', '')));
  }

  getStats() {
    return { id: this.id, name: this.name, domain: this.domain, resources: this.resources.size, members: this.members.size, adapters: [...this.adapters.keys()], status: 'active' };
  }

  async destroy() {
    await Promise.allSettled([...this.adapters.values()].map(adapter => adapter.destroy?.() || adapter.disconnect?.()));
    this.adapters.clear();
  }
}

class WorkspaceManager {
  constructor() { this.workspaces = new Map(); }
  createWorkspace(config) { const workspace = new Workspace(config); this.workspaces.set(workspace.id, workspace); return workspace; }
  getWorkspace(id) { return this.workspaces.get(id); }
  listWorkspaces(userId) { return [...this.workspaces.values()].filter(w => w.members.has(userId)).map(w => w.getStats()); }
  async routeCommand(workspaceId, userId, command, params) { const workspace = this.getWorkspace(workspaceId); if (!workspace) throw new Error('Workspace not found'); return workspace.executeCommand(userId, command, params); }
  async destroyWorkspace(id) { const workspace = this.workspaces.get(id); if (!workspace) return false; await workspace.destroy(); return this.workspaces.delete(id); }
}

export { Workspace, WorkspaceManager };
