import { PluginRegistry } from '../../src/plugins/registry.js';

describe('PluginRegistry adapter boundary', () => {
  test('loads and dispatches an injected adapter without Core imports', async () => {
    const registry = new PluginRegistry();
    const calls = [];
    registry.register('example', async () => ({
      connected: false,
      async connect() { this.connected = true; },
      async disconnect() { this.connected = false; },
      async discover() { return [{ id: 'example:1', type: 'example.resource', can: capability => capability === 'example.read' }]; },
      async executeTool(action, params) { calls.push({ action, params }); return { ok: true, action, params }; },
      async destroy() { this.connected = false; }
    }));

    await registry.load('example', { scope: { tenantId: 't1' } });
    expect(registry.listAdapters()).toEqual(['example']);
    expect(registry.findByType('example.resource')).toHaveLength(1);
    expect(registry.findByCapability('example.read')).toHaveLength(1);
    await expect(registry.execute('example:1', 'example.read', { value: 1 })).resolves.toMatchObject({ ok: true });
    expect(calls).toEqual([{ action: 'example.read', params: { value: 1 } }]);
    await registry.shutdown();
  });
});
