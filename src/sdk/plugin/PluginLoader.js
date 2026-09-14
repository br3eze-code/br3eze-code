import { isPlugin } from './Plugin.js';

export class PluginLoader {
  constructor({ registry, runtime = {} } = {}) { if (!registry) throw new TypeError('PluginLoader requires a registry'); this.registry = registry; this.runtime = runtime; }
  async load(candidate) { const plugin = typeof candidate === 'function' ? new candidate() : candidate?.default ?? candidate; if (!isPlugin(plugin)) throw new TypeError('Loaded module does not expose an AgentOS Plugin'); this.registry.register(plugin); await plugin.initialize(this.runtime); await plugin.start(); return plugin; }
  async unload(id) { const plugin = this.registry.get(id); if (!plugin) return false; await plugin.stop?.(); this.registry.unregister(id); return true; }
}
