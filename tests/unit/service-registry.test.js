import ServiceRegistry from '../../src/services/registry.js';

describe('ServiceRegistry', () => {
  test('loads services lazily and manages lifecycle', async () => {
    const registry = new ServiceRegistry();
    const events = [];
    registry.register('example', async ({ value }) => ({
      value,
      async initialize() { events.push('init'); },
      async shutdown() { events.push('shutdown'); }
    }));
    expect(registry.list()).toEqual(['example']);
    const service = await registry.load('example', { value: 7 });
    expect(service.value).toBe(7);
    expect(registry.get('example')).toBe(service);
    await registry.unload('example');
    expect(events).toEqual(['init', 'shutdown']);
  });
});
