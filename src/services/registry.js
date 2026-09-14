/**
 * Application service registry.
 * Services are domain/application logic and are never imported by Core.
 * They are injected into the host and loaded explicitly by capability name.
 */
export class ServiceRegistry {
  constructor() { this.definitions = new Map(); this.instances = new Map(); }
  register(name, factory) {
    if (!name || typeof factory !== 'function') throw new TypeError('Service name and factory are required');
    this.definitions.set(name, factory); return this;
  }
  async load(name, context = {}) {
    if (this.instances.has(name)) return this.instances.get(name);
    const factory = this.definitions.get(name);
    if (!factory) throw new Error(`Service '${name}' is not registered`);
    const service = await factory(context);
    if (!service) throw new Error(`Service '${name}' factory returned no service`);
    await service.initialize?.(context);
    this.instances.set(name, service);
    return service;
  }
  registerInstance(name, service) { if (!name || !service) throw new TypeError('Service name and instance are required'); this.instances.set(name, service); return service; }
  get(name) { return this.instances.get(name) || null; }
  list() { return [...new Set([...this.definitions.keys(), ...this.instances.keys()])]; }
  async unload(name) { const service = this.instances.get(name); if (!service) return false; await service.shutdown?.(); await service.destroy?.(); this.instances.delete(name); return true; }
  async shutdown() { await Promise.allSettled([...this.instances.keys()].map(name => this.unload(name))); }
}
export default ServiceRegistry;
