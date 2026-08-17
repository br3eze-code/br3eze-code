const NODE_STATUSES = new Set(['enrolling', 'online', 'offline', 'quarantined', 'suspended', 'retired']);

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  error.status = 400;
  return error;
}

function scopeError() {
  const error = new Error('Resource is not available in this scope');
  error.code = 'MESH_RESOURCE_NOT_FOUND';
  error.status = 404;
  return error;
}

function conflict(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 409;
  return error;
}

function required(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw validationError(`${name} is required`);
  return value.trim();
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function groupFromRow(row) {
  return row && {
    tenantId: row.tenant_id,
    meshGroupId: row.mesh_group_id,
    projectId: row.project_id,
    meshKey: row.mesh_key,
    displayName: row.display_name,
    status: row.status,
    createdByPrincipalId: row.created_by_principal_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function siteFromRow(row) {
  return row && {
    tenantId: row.tenant_id,
    meshGroupId: row.mesh_group_id,
    siteId: row.site_id,
    siteKey: row.site_key,
    displayName: row.display_name,
    timezone: row.timezone,
    status: row.status,
    createdByPrincipalId: row.created_by_principal_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function nodeFromRow(row) {
  return row && {
    tenantId: row.tenant_id,
    meshGroupId: row.mesh_group_id,
    siteId: row.site_id,
    nodeId: row.node_id,
    nodeKey: row.node_key,
    nodeType: row.node_type,
    displayName: row.display_name,
    transport: row.transport || 'outbound_agent',
    status: row.status,
    fingerprintHash: row.fingerprint_hash ? Buffer.from(row.fingerprint_hash).toString('base64url') : null,
    capabilities: row.capabilities || {},
    lastSeenAt: iso(row.last_seen_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

export class PostgresMeshManagementStore {
  constructor({ pool, connectionString, max = 10, ssl, schema = 'public' } = {}) {
    if (!pool && !connectionString && !process.env.DATABASE_URL) {
      throw new Error('PostgresMeshManagementStore requires pool, connectionString, or DATABASE_URL');
    }
    this.pool = pool || null;
    this.poolOptions = { connectionString: connectionString || process.env.DATABASE_URL, max, ssl };
    this.schema = /^[a-z_][a-z0-9_]*$/i.test(schema) ? schema : 'public';
    this.tables = {
      groups: `${this.schema}.agentos_mesh_groups`,
      sites: `${this.schema}.agentos_sites`,
      nodes: `${this.schema}.agentos_mesh_nodes`
    };
  }

  async _ensurePool() {
    if (this.pool) return this.pool;
    const module = await import('pg');
    const Pool = module.default?.Pool || module.Pool;
    if (typeof Pool !== 'function') throw new Error('pg Pool export is unavailable');
    this.pool = new Pool(this.poolOptions);
    return this.pool;
  }

  async _transaction({ tenantId, principalId }, callback) {
    const pool = await this._ensurePool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.principal_id', $2, true)", [tenantId, principalId]);
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') {
        if (error.constraint?.includes('mesh_key')) throw conflict('MESH_GROUP_KEY_CONFLICT', 'meshKey already exists in tenant scope');
        if (error.constraint?.includes('site_key')) throw conflict('SITE_KEY_CONFLICT', 'siteKey already exists in mesh group scope');
        if (error.constraint?.includes('node_key')) throw conflict('NODE_KEY_CONFLICT', 'nodeKey already exists in site scope');
        if (error.constraint?.includes('one_active_mesh')) throw conflict('MESH_GROUP_LIMIT_REACHED', 'Tenant already has an active mesh group');
      }
      if (error.code === '23503' || error.code === '42501') throw scopeError();
      throw error;
    } finally {
      client.release();
    }
  }

  async _query({ tenantId, principalId }, text, values = []) {
    return this._transaction({ tenantId, principalId }, (client) => client.query(text, values));
  }

  async createMeshGroup({ tenantId, principalId, projectId = null, displayName, meshKey }) {
    const name = required(displayName, 'displayName');
    const key = required(meshKey, 'meshKey');
    const result = await this._query({ tenantId, principalId }, `
      INSERT INTO ${this.tables.groups}
        (tenant_id, project_id, mesh_key, display_name, created_by_principal_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *`, [tenantId, projectId, key, name, principalId]);
    return groupFromRow(result.rows[0]);
  }

  async listMeshGroups(tenantId, principalId = '00000000-0000-0000-0000-000000000000') {
    const result = await this._query({ tenantId, principalId }, `SELECT * FROM ${this.tables.groups} WHERE tenant_id = $1 ORDER BY created_at`, [tenantId]);
    return result.rows.map(groupFromRow);
  }

  async getMeshGroup(tenantId, meshGroupId, principalId = '00000000-0000-0000-0000-000000000000') {
    const result = await this._query({ tenantId, principalId }, `SELECT * FROM ${this.tables.groups} WHERE tenant_id = $1 AND mesh_group_id = $2`, [tenantId, meshGroupId]);
    if (!result.rows[0]) throw scopeError();
    return groupFromRow(result.rows[0]);
  }

  async createSite({ tenantId, principalId, meshGroupId, siteKey, displayName, timezone = 'UTC' }) {
    const key = required(siteKey, 'siteKey');
    const name = required(displayName, 'displayName');
    const result = await this._query({ tenantId, principalId }, `
      INSERT INTO ${this.tables.sites}
        (tenant_id, mesh_group_id, site_key, display_name, timezone, created_by_principal_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`, [tenantId, meshGroupId, key, name, timezone, principalId]);
    return siteFromRow(result.rows[0]);
  }

  async listSites(tenantId, meshGroupId, principalId = '00000000-0000-0000-0000-000000000000') {
    const result = await this._query({ tenantId, principalId }, `SELECT * FROM ${this.tables.sites} WHERE tenant_id = $1 AND mesh_group_id = $2 ORDER BY created_at`, [tenantId, meshGroupId]);
    return result.rows.map(siteFromRow);
  }

  async getSite(tenantId, meshGroupId, siteId, principalId = '00000000-0000-0000-0000-000000000000') {
    const result = await this._query({ tenantId, principalId }, `SELECT * FROM ${this.tables.sites} WHERE tenant_id = $1 AND mesh_group_id = $2 AND site_id = $3`, [tenantId, meshGroupId, siteId]);
    if (!result.rows[0]) throw scopeError();
    return siteFromRow(result.rows[0]);
  }

  async createNode({ tenantId, principalId, meshGroupId, siteId, nodeKey, nodeType, displayName, transport = 'outbound_agent' }) {
    const key = required(nodeKey, 'nodeKey');
    const type = required(nodeType, 'nodeType');
    const name = required(displayName, 'displayName');
    const result = await this._query({ tenantId, principalId }, `
      INSERT INTO ${this.tables.nodes}
        (tenant_id, mesh_group_id, site_id, node_key, node_type, display_name, capabilities)
      VALUES ($1, $2, $3, $4, $5, $6, jsonb_build_object('transport', $7))
      RETURNING *`, [tenantId, meshGroupId, siteId, key, type, name, transport]);
    return nodeFromRow(result.rows[0]);
  }

  async listNodes(tenantId, meshGroupId, siteId, principalId = '00000000-0000-0000-0000-000000000000') {
    const result = await this._query({ tenantId, principalId }, `SELECT * FROM ${this.tables.nodes} WHERE tenant_id = $1 AND mesh_group_id = $2 AND site_id = $3 ORDER BY created_at`, [tenantId, meshGroupId, siteId]);
    return result.rows.map(nodeFromRow);
  }

  async getNode(tenantId, meshGroupId, siteId, nodeId, principalId = '00000000-0000-0000-0000-000000000000') {
    const result = await this._query({ tenantId, principalId }, `SELECT * FROM ${this.tables.nodes} WHERE tenant_id = $1 AND mesh_group_id = $2 AND site_id = $3 AND node_id = $4`, [tenantId, meshGroupId, siteId, nodeId]);
    if (!result.rows[0]) throw scopeError();
    return nodeFromRow(result.rows[0]);
  }

  async updateNodeStatus({ tenantId, principalId, meshGroupId, siteId, nodeId, status }) {
    if (!NODE_STATUSES.has(status)) throw validationError('Invalid node status');
    const result = await this._query({ tenantId, principalId }, `
      UPDATE ${this.tables.nodes}
      SET status = $1
      WHERE tenant_id = $2 AND mesh_group_id = $3 AND site_id = $4 AND node_id = $5
      RETURNING *`, [status, tenantId, meshGroupId, siteId, nodeId]);
    if (!result.rows[0]) throw scopeError();
    return nodeFromRow(result.rows[0]);
  }

  async close() {
    if (this.pool && typeof this.pool.end === 'function') await this.pool.end();
  }
}

export default PostgresMeshManagementStore;
