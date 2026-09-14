/**
 * Adapter Registry
 *
 * This registry is intentionally outside Core. It owns adapter registration,
 * lifecycle, resource indexing and action dispatch. Concrete adapters are
 * supplied by the composition root; the registry must not know any domain.
 */

function unwrap(module) {
  return module?.default ?? module?.MikroTikAdapter ?? module;
}

class PluginRegistry {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.adapters = new Map();
    this.resourceIndex = new Map();
    this.definitions = new Map();
  }

  register(name, AdapterClassOrLoader) {
    if (!name || !AdapterClassOrLoader) {
      throw new TypeError('Adapter name and implementation are required');
    }
    this.definitions.set(name, AdapterClassOrLoader);
    return this;
  }

  async load(name, config = {}) {
    const definition = this.definitions.get(name);
    if (!definition) {
      throw new Error(`Adapter '${name}' not found. Registered: ${[...this.definitions.keys()].join(', ')}`);
    }

    const module = typeof definition === 'function' && definition.constructor?.name === 'AsyncFunction'
      ? await definition()
      : definition;
    const AdapterClass = unwrap(module);
    const instance = typeof AdapterClass === 'function' ? new AdapterClass(config) : AdapterClass;

    if (!instance || typeof instance.connect !== 'function' || typeof instance.executeTool !== 'function') {
      throw new TypeError(`Adapter '${name}' does not satisfy the adapter contract`);
    }

    await instance.connect();
    this.adapters.set(name, instance);
    const resources = typeof instance.discover === 'function' ? await instance.discover() : [];
    for (const resource of resources || []) this.index(name, resource);
    return instance;
  }

  index(adapterName, resource) {
    if (!resource?.id) return;
    this.resourceIndex.set(resource.id, { adapter: adapterName, resource });
  }

  async discoverAll() {
    const all = [];
    for (const [name, adapter] of this.adapters) {
      if (!adapter.connected) continue;
      const resources = await adapter.discover?.() || [];
      for (const resource of resources) {
        this.index(name, resource);
        all.push(resource);
      }
    }
    return all;
  }

  async execute(resourceId, action, params = {}) {
    const location = this.resourceIndex.get(resourceId);
    if (!location) throw new Error(`Resource '${resourceId}' is not registered`);
    const adapter = this.adapters.get(location.adapter);
    if (!adapter) throw new Error(`Adapter '${location.adapter}' is not loaded`);
    return adapter.executeTool(action, params, { resourceId, resource: location.resource });
  }

  findByType(type) {
    return [...this.resourceIndex.values()]
      .filter(({ resource }) => resource.type === type)
      .map(({ resource }) => resource);
  }

  findByCapability(capability) {
    return [...this.resourceIndex.values()]
      .filter(({ resource }) => typeof resource.can === 'function' && resource.can(capability))
      .map(({ resource }) => resource);
  }

  getAdapter(name) { return this.adapters.get(name) || null; }
  listAdapters() { return [...this.adapters.keys()]; }

  async unload(name) {
    const adapter = this.adapters.get(name);
    if (!adapter) return false;
    await adapter.disconnect?.();
    adapter.destroy?.();
    this.adapters.delete(name);
    for (const [id, location] of this.resourceIndex) {
      if (location.adapter === name) this.resourceIndex.delete(id);
    }
    return true;
  }

  async shutdown() {
    await Promise.allSettled([...this.adapters.keys()].map(name => this.unload(name)));
    this.resourceIndex.clear();
  }
}

export { PluginRegistry };
export default new PluginRegistry();
