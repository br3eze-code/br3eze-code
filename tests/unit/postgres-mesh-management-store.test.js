import PostgresMeshManagementStore from '../../src/core/postgres-mesh-management-store.js';

function fakePool(rows = []) {
  const queries = [];
  const client = {
    query: async (text, values) => {
      queries.push({ text: String(text), values });
      if (String(text).includes('INSERT INTO')) return { rows: rows.length ? rows : [{
        tenant_id: 'tenant-a',
        mesh_group_id: 'mesh-a',
        project_id: null,
        mesh_key: 'mesh-key',
        display_name: 'Mesh A',
        status: 'provisioning',
        created_by_principal_id: 'principal-a',
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z')
      }] };
      return { rows };
    }
  };
  return {
    queries,
    connect: async () => ({ ...client, release() {} })
  };
}

describe('PostgresMeshManagementStore', () => {
  test('sets tenant and principal RLS context before a scoped write', async () => {
    const pool = fakePool();
    const store = new PostgresMeshManagementStore({ pool });
    const group = await store.createMeshGroup({
      tenantId: 'tenant-a',
      principalId: 'principal-a',
      displayName: 'Mesh A',
      meshKey: 'mesh-key'
    });

    expect(group.tenantId).toBe('tenant-a');
    expect(pool.queries[0].text).toBe('BEGIN');
    expect(pool.queries[1].text).toContain('set_config');
    expect(pool.queries[1].values).toEqual(['tenant-a', 'principal-a']);
    expect(pool.queries.at(-1).text).toBe('COMMIT');
  });

  test('uses complete tenant, mesh, site, and node scope for status updates', async () => {
    const pool = fakePool([{
      tenant_id: 'tenant-a', mesh_group_id: 'mesh-a', site_id: 'site-a', node_id: 'node-a',
      node_key: 'router-a', node_type: 'mikrotik', display_name: 'Router A', status: 'online',
      capabilities: {}, created_at: new Date(), updated_at: new Date()
    }]);
    const store = new PostgresMeshManagementStore({ pool });
    const node = await store.updateNodeStatus({
      tenantId: 'tenant-a', principalId: 'principal-a', meshGroupId: 'mesh-a', siteId: 'site-a', nodeId: 'node-a', status: 'online'
    });

    expect(node.nodeId).toBe('node-a');
    const update = pool.queries.find((query) => query.text.includes('UPDATE'));
    expect(update.values).toEqual(['online', 'tenant-a', 'mesh-a', 'site-a', 'node-a']);
  });

  test('rejects unsupported node status before opening a transaction', async () => {
    const pool = fakePool();
    const store = new PostgresMeshManagementStore({ pool });
    await expect(store.updateNodeStatus({
      tenantId: 'tenant-a', principalId: 'principal-a', meshGroupId: 'mesh-a', siteId: 'site-a', nodeId: 'node-a', status: 'unknown'
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(pool.queries).toHaveLength(0);
  });
});
