import { randomUUID } from 'node:crypto';
import UniversalBilling from './universal-billing.js';
import UniversalAICoordinator from '../ai/universal-coordinator.js';

// src/core/workspace.js
/**
 * Multi-Tenant Workspace System
 */

class Workspace {
  constructor(config = {}) {
    this.id = config.id || randomUUID();
    this.name = config.name;
    this.domain = config.domain || 'generic'; // 'network', 'cloud', 'iot', 'hybrid'
    this.owner = config.owner;
    this.members = new Map(); // userId -> role
    this.resources = new Set(); // Resource IDs
    this.adapters = new Map(); // adapterName -> adapterInstance
    this.config = config.settings || {};
    this.billing = null;
    this.aiCoordinator = null;
  }

  async initialize(pluginRegistry) {
    for (const adapterConfig of this.config.adapters || []) {
      const adapter = await pluginRegistry.load(adapterConfig.type, adapterConfig);
      this.adapters.set(adapterConfig.type, adapter);
    }

    this.billing = new UniversalBilling({
      database: this.config.database,
      resourceType: this.domain
    });

    this.aiCoordinator = new UniversalAICoordinator({
      domain: this.domain,
      registry: this,
      workspace: this.config
    });

    return this;
  }

  async executeCommand(userId, command, params = {}) {
    if (!this.canExecute(userId, command)) {
      throw new Error('Unauthorized');
    }

    return this.aiCoordinator.processQuery(command, {
      userId,
      workspace: this.id,
      ...params
    });
  }

  canExecute(userId, command) {
    const role = this.members.get(userId);
    if (!role) return false;

    const permissions = {
      owner: ['*'],
      admin: ['resource.*', 'billing.*', 'user.*'],
      operator: ['resource.read', 'resource.execute'],
      viewer: ['resource.read']
    };

    const allowed = permissions[role] || [];
    return allowed.includes('*') || allowed.some(permission => command.startsWith(permission.replace('*', '')));
  }

  getStats() {
    return {
      id: this.id,
      name: this.name,
      domain: this.domain,
      resources: this.resources.size,
      members: this.members.size,
      adapters: Array.from(this.adapters.keys()),
      status: 'active'
    };
  }

  destroy() {
    for (const adapter of this.adapters.values()) {
      adapter.destroy?.();
    }
    this.adapters.clear();
    this.billing = null;
    this.aiCoordinator = null;
  }
}

class WorkspaceManager {
  constructor() {
    this.workspaces = new Map();
  }

  createWorkspace(config) {
    const workspace = new Workspace(config);
    this.workspaces.set(workspace.id, workspace);
    return workspace;
  }

  getWorkspace(id) {
    return this.workspaces.get(id);
  }

  listWorkspaces(userId) {
    return Array.from(this.workspaces.values())
      .filter(workspace => workspace.members.has(userId))
      .map(workspace => workspace.getStats());
  }

  async routeCommand(workspaceId, userId, command, params) {
    const workspace = this.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    return workspace.executeCommand(userId, command, params);
  }
}

export { Workspace, WorkspaceManager };
