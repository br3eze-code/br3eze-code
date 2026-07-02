// src/plugins/registry.js
/**
 * Plugin Registry - Dynamic adapter loading and management
 */

class PluginRegistry {
  constructor() {
    this.adapters = new Map();
    this.resourceIndex = new Map();
  }

  // Register built-in adapters — optional SDKs are wrapped gracefully
  registerBuiltins() {
    const builtin = [
      ['mikrotik', './adapters/mikrotik-adapter'],
      ['aws', './adapters/aws-adapter'],
      ['docker', './adapters/docker-adapter'],
      ['kubernetes', './adapters/kubernetes-adapter'],
      ['proxmox', './adapters/proxmox-adapter'],
    ];
    for (const [name, path] of builtin) {
      try {
        this.register(name, require(path));
      } catch (err) {
        console.warn(`⚠️  Adapter '${name}' skipped: ${err.message.split('\n')[0]}`);
      }
    }
  }

  // Register custom adapter
  register(name, AdapterClass) {
    this.adapters.set(name, AdapterClass);
    console.log(`✅ Registered adapter: ${name}`);
  }

  // Load adapter instance
  async load(name, config) {
    const AdapterClass = this.adapters.get(name);
    if (!AdapterClass) {
      throw new Error(
        `Adapter '${name}' not found. Registered: ${Array.from(this.adapters.keys())}`
      );
    }

    const instance = new AdapterClass(config);
    await instance.connect();

    // Index resources
    instance.on('resource discovered', resource => {
      this.resourceIndex.set(resource.id, { adapter: name, resource });
    });

    return instance;
  }

  // Discover all resources across all connected adapters
  async discoverAll() {
    const allResources = [];
    for (const [name, adapter] of this.adapters) {
      if (adapter.connected) {
        const resources = await adapter.discover();
        allResources.push(...resources);
      }
    }
    return allResources;
  }

  // Route command to appropriate adapter
  async execute(resourceId, action, params) {
    const location = this.resourceIndex.get(resourceId);
    if (!location) {
      throw new Error(`Resource ${resourceId} not found in any adapter`);
    }

    const adapter = this.adapters.get(location.adapter);
    return await adapter.execute(resourceId, action, params);
  }

  // Find resources by type
  findByType(type) {
    return Array.from(this.resourceIndex.values())
      .filter(({ resource }) => resource.type === type)
      .map(({ resource }) => resource);
  }

  // Find resources by capability
  findByCapability(capability) {
    return Array.from(this.resourceIndex.values())
      .filter(({ resource }) => resource.can(capability))
      .map(({ resource }) => resource);
  }

  getAdapter(name) {
    return this.adapters.get(name);
  }

  listAdapters() {
    return Array.from(this.adapters.keys());
  }
}

module.exports = new PluginRegistry();
