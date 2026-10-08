export class PluginContext {
  constructor({ plugin, logger = console, config = {}, services = new Map(), adapters = new Map(), eventBus = null, telemetry = null, authorize = () => true, runtime = null } = {}) {
    this.plugin = plugin; this.logger = logger; this.config = Object.freeze({ ...config });
    this._services = services; this._adapters = adapters; this._eventBus = eventBus; this._telemetry = telemetry; this._authorize = authorize; this._runtime = runtime;
  }
  authorize(permission) { return Boolean(this._authorize(permission, this.plugin)); }
  requirePermission(permission) { if (!this.authorize(permission)) throw new Error(`Plugin '${this.plugin.id}' is not authorized for '${permission}'`); }
  getService(id) { this.requirePermission(`service:${id}`); return this._services.get(id); }
  getAdapter(id) { this.requirePermission(`adapter:${id}`); return this._adapters.get(id); }
  on(event, handler) { if (!this._eventBus?.on) throw new Error('Event bus is unavailable'); this.requirePermission(`event:${event}`); return this._eventBus.on(event, handler); }
  emit(event, payload) { this.requirePermission(`event:${event}`); return this._eventBus?.emit?.(event, payload); }
  registerTool(tool) {
    this.requirePermission('capability:register');
    if (!this._runtime?.registerTool) throw new Error('Plugin runtime does not expose registerTool');
    return this._runtime.registerTool(tool);
  }

  registerSkill(skill) {
    this.requirePermission('capability:register');
    if (!this._runtime?.registerSkill) throw new Error('Plugin runtime does not expose registerSkill');
    return this._runtime.registerSkill(skill);
  }

  metric(name, value = 1, tags = {}) { return this._telemetry?.record?.(name, value, { plugin: this.plugin.id, ...tags }); }
}
