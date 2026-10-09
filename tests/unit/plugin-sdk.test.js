import { Plugin, PluginContext, PluginLoader, PluginManifest, PluginRegistry } from '../../src/sdk/plugin/index.js';

describe('AgentOS Plugin SDK', () => {
  test('validates and freezes manifests', () => {
    const manifest = new PluginManifest({ id: 'example.test', version: '1.0.0', capabilities: ['demo'] });
    expect(manifest.id).toBe('example.test');
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(() => new PluginManifest({ version: '1.0.0' })).toThrow();
  });

  test('enforces context permissions before accessing extensions', () => {
    const plugin = { id: 'example.test' };
    const ctx = new PluginContext({ plugin, services: new Map([['demo', 1]]), authorize: (p) => p === 'service:demo' });
    expect(ctx.getService('demo')).toBe(1);
    expect(() => ctx.getService('secret')).toThrow();
  });

  test('loads and unloads a plugin through the SDK lifecycle', async () => {
    const events = [];
    class TestPlugin extends Plugin {
      constructor() { super({ id: 'example.lifecycle', version: '1.0.0', capabilities: ['demo'] }); }
      async onInitialize() { events.push('initialize'); }
      async onStart() { events.push('start'); }
      async onStop() { events.push('stop'); }
    }
    const registry = new PluginRegistry();
    const loader = new PluginLoader({ registry, runtime: { authorize: () => true } });
    const plugin = await loader.load(TestPlugin);
    expect(plugin.state).toBe('started');
    expect(registry.has('example.lifecycle')).toBe(true);
    await loader.unload('example.lifecycle');
    expect(events).toEqual(['initialize', 'start', 'stop']);
    expect(registry.has('example.lifecycle')).toBe(false);
  });
});
