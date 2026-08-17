import crypto from 'node:crypto';

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function required(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    const error = new Error(`${name} is required`);
    error.code = 'VALIDATION_ERROR';
    error.status = 400;
    throw error;
  }
  return value.trim();
}

function scopeError() {
  const error = new Error('Resource is not available in this scope');
  error.code = 'MESH_RESOURCE_NOT_FOUND';
  error.status = 404;
  return error;
}

export class MeshManagementStore {
  constructor() {
    this.meshGroups = new Map();
    this.sites = new Map();
    this.nodes = new Map();
    this.idempotency = new Map();
  }

  _key(tenantId, resourceId) {
    return `${tenantId}:${resourceId}`;
  }

  _remember(tenantId, principalId, key, response) {
    if (!key) return response;
    this.idempotency.set(`${tenantId}:${principalId}:${key}`, response);
    return response;
  }

  replay(tenantId, principalId, key) {
    return key ? this.idempotency.get(`${tenantId}:${principalId}:${key}`) : undefined;
  }

  createMeshGroup({ tenantId, principalId, projectId = null, displayName, meshKey, idempotencyKey }) {
    const name = required(displayName, 'displayName');
    const key = required(meshKey, 'meshKey');
    const existingReplay = this.replay(tenantId, principalId, idempotencyKey);
    if (existingReplay) return existingReplay;
    for (const group of this.meshGroups.values()) {
      if (group.tenantId === tenantId && group.status !== 'retired') {
        const error = new Error('Tenant already has an active mesh group');
        error.code = 'MESH_GROUP_LIMIT_REACHED';
        error.status = 409;
        throw error;
      }
      if (group.tenantId === tenantId && group.meshKey === key) {
        const error = new Error('meshKey already exists in tenant scope');
        error.code = 'MESH_GROUP_KEY_CONFLICT';
        error.status = 409;
        throw error;
      }
    }
    const group = {
      tenantId, meshGroupId: id('mesh'), projectId, meshKey: key, displayName: name,
      status: 'provisioning', createdByPrincipalId: principalId,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    this.meshGroups.set(this._key(tenantId, group.meshGroupId), group);
    return this._remember(tenantId, principalId, idempotencyKey, group);
  }

  listMeshGroups(tenantId) {
    return [...this.meshGroups.values()].filter((item) => item.tenantId === tenantId);
  }

  getMeshGroup(tenantId, meshGroupId) {
    const group = this.meshGroups.get(this._key(tenantId, meshGroupId));
    if (!group) throw scopeError();
    return group;
  }

  createSite({ tenantId, principalId, meshGroupId, siteKey, displayName, timezone = 'UTC', idempotencyKey }) {
    const group = this.getMeshGroup(tenantId, meshGroupId);
    const key = required(siteKey, 'siteKey');
    const name = required(displayName, 'displayName');
    const existingReplay = this.replay(tenantId, principalId, idempotencyKey);
    if (existingReplay) return existingReplay;
    for (const site of this.sites.values()) {
      if (site.tenantId === tenantId && site.meshGroupId === meshGroupId && site.siteKey === key) {
        const error = new Error('siteKey already exists in mesh group scope');
        error.code = 'SITE_KEY_CONFLICT';
        error.status = 409;
        throw error;
      }
    }
    const site = {
      tenantId, meshGroupId: group.meshGroupId, siteId: id('site'), siteKey: key,
      displayName: name, timezone, status: 'pending', createdByPrincipalId: principalId,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    this.sites.set(this._key(tenantId, site.siteId), site);
    return this._remember(tenantId, principalId, idempotencyKey, site);
  }

  listSites(tenantId, meshGroupId) {
    this.getMeshGroup(tenantId, meshGroupId);
    return [...this.sites.values()].filter((item) => item.tenantId === tenantId && item.meshGroupId === meshGroupId);
  }

  getSite(tenantId, meshGroupId, siteId) {
    const site = this.sites.get(this._key(tenantId, siteId));
    if (!site || site.meshGroupId !== meshGroupId) throw scopeError();
    return site;
  }

  createNode({ tenantId, principalId, meshGroupId, siteId, nodeKey, nodeType, displayName, transport = 'outbound_agent', idempotencyKey }) {
    const site = this.getSite(tenantId, meshGroupId, siteId);
    const key = required(nodeKey, 'nodeKey');
    const type = required(nodeType, 'nodeType');
    const name = required(displayName, 'displayName');
    const existingReplay = this.replay(tenantId, principalId, idempotencyKey);
    if (existingReplay) return existingReplay;
    for (const node of this.nodes.values()) {
      if (node.tenantId === tenantId && node.meshGroupId === meshGroupId && node.siteId === site.siteId && node.nodeKey === key) {
        const error = new Error('nodeKey already exists in site scope');
        error.code = 'NODE_KEY_CONFLICT';
        error.status = 409;
        throw error;
      }
    }
    const node = {
      tenantId, meshGroupId, siteId: site.siteId, nodeId: id('node'), nodeKey: key,
      nodeType: type, displayName: name, transport, status: 'enrolling',
      capabilities: {}, createdByPrincipalId: principalId,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    this.nodes.set(this._key(tenantId, node.nodeId), node);
    return this._remember(tenantId, principalId, idempotencyKey, node);
  }

  listNodes(tenantId, meshGroupId, siteId) {
    this.getSite(tenantId, meshGroupId, siteId);
    return [...this.nodes.values()].filter((item) => item.tenantId === tenantId && item.meshGroupId === meshGroupId && item.siteId === siteId);
  }

  getNode(tenantId, meshGroupId, siteId, nodeId) {
    const node = this.nodes.get(this._key(tenantId, nodeId));
    if (!node || node.meshGroupId !== meshGroupId || node.siteId !== siteId) throw scopeError();
    return node;
  }

  updateNodeStatus({ tenantId, principalId, meshGroupId, siteId, nodeId, status, idempotencyKey }) {
    const node = this.getNode(tenantId, meshGroupId, siteId, nodeId);
    const allowed = new Set(['enrolling', 'online', 'offline', 'quarantined', 'suspended', 'retired']);
    if (!allowed.has(status)) {
      const error = new Error('Invalid node status');
      error.code = 'VALIDATION_ERROR';
      error.status = 400;
      throw error;
    }
    const existingReplay = this.replay(tenantId, principalId, idempotencyKey);
    if (existingReplay) return existingReplay;
    const updated = { ...node, status, updatedAt: new Date().toISOString() };
    this.nodes.set(this._key(tenantId, nodeId), updated);
    return this._remember(tenantId, principalId, idempotencyKey, updated);
  }
}

export default MeshManagementStore;
