import { isPlugin } from './Plugin.js';
import { normalizeManifest } from './PluginManifest.js';

export class PluginRegistry {
  constructor() { this._plugins = new Map(); }
  register(plugin) { if (!isPlugin(plugin)) throw new TypeError('PluginRegistry.register expects an AgentOS Plugin'); const m = normalizeManifest(plugin.getManifest()); if (this._plugins.has(m.id)) throw new Error(`Plugin '${m.id}' is already registered`); this._plugins.set(m.id, plugin); return plugin; }
  unregister(id) { const p = this._plugins.get(id); this._plugins.delete(id); return p; }
  get(id) { return this._plugins.get(id); }
  has(id) { return this._plugins.has(id); }
  list() { return [...this._plugins.values()].map((p) => p.getManifest()); }
  values() { return [...this._plugins.values()]; }
  clear() { this._plugins.clear(); }
}
