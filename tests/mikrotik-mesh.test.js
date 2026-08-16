import MikroTikMeshRegistry from '../src/core/mikrotik-mesh.js';

describe('MikroTikMeshRegistry', () => {
  const makeManager = () => ({
    state: { isConnected: false },
    async connect() { this.state.isConnected = true; },
    async executeTool(tool, params) { return { tool, params, ok: true }; },
    async destroy() {},
  });

  test('rejects public router exposure and enforces tenant/site boundaries', async () => {
    const mesh = new MikroTikMeshRegistry({ managerFactory: makeManager });
    expect(() => mesh.register({ id: 'site-1', host: '203.0.113.10', publicAddress: true })).toThrow(/public router exposure/);
    mesh.register({ id: 'site-1', host: '10.20.0.1', tenantId: 'tenant-a' });
    expect(() => mesh.list({ tenantId: 'tenant-b' })).not.toThrow();
    await expect(mesh.execute('site-1', 'system.health', {}, { tenantId: 'tenant-b' })).rejects.toThrow(/tenant boundary/);
  });

  test('requires confirmation for mutations and executes read-only tools', async () => {
    const mesh = new MikroTikMeshRegistry({ managerFactory: makeManager });
    mesh.register({ id: 'site-1', host: '10.20.0.1', tenantId: 'tenant-a' });
    await expect(mesh.execute('site-1', 'firewall.block', {}, { tenantId: 'tenant-a' }))
      .rejects.toMatchObject({ code: 'MESH_CONFIRMATION_REQUIRED' });
    const result = await mesh.execute('site-1', 'system.health', {}, { tenantId: 'tenant-a' });
    expect(result.result.ok).toBe(true);
  });

  test('requires explicit fleet permission and emits redacted audit data', async () => {
    const events = [];
    const mesh = new MikroTikMeshRegistry({ managerFactory: makeManager, auditSink: (event) => events.push(event) });
    mesh.register({ id: 'site-1', host: '10.20.0.1', tenantId: 'tenant-a' });
    mesh.register({ id: 'site-2', host: '10.20.1.1', tenantId: 'tenant-a' });
    await expect(mesh.executeFleet(['site-1', 'site-2'], 'system.health', {}, { tenantId: 'tenant-a' }))
      .rejects.toThrow(/allowFleet/);
    const results = await mesh.executeFleet(['site-1', 'site-2'], 'system.health', {}, {
      tenantId: 'tenant-a', allowFleet: true, authorization: 'secret-value',
    });
    expect(results).toHaveLength(2);
    expect(events[0].context.authorization).toBe('[REDACTED]');
  });
});
