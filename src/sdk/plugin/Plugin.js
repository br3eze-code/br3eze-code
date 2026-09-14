import { normalizeManifest } from './PluginManifest.js';
import { PluginContext } from './PluginContext.js';

export class Plugin {
  constructor(manifest = {}) { this.manifest = normalizeManifest(manifest); this.id = this.manifest.id; this.version = this.manifest.version; this.state = 'created'; this.context = null; }
  async initialize(runtime = {}) { if (!['created', 'stopped'].includes(this.state)) throw new Error(`Plugin '${this.id}' cannot initialize from ${this.state}`); this.context = new PluginContext({ plugin: this.manifest, ...runtime }); await this.onInitialize?.(this.context); this.state = 'initialized'; return this; }
  async start() { if (this.state !== 'initialized') throw new Error(`Plugin '${this.id}' must be initialized before start`); await this.onStart?.(this.context); this.state = 'started'; return this; }
  async stop() { if (this.state === 'stopped') return this; await this.onStop?.(this.context); this.state = 'stopped'; return this; }
  getManifest() { return this.manifest; }
  getCapabilities() { return [...this.manifest.capabilities]; }
}
export const isPlugin = (v) => v instanceof Plugin || Boolean(v && typeof v.initialize === 'function' && typeof v.getManifest === 'function');
