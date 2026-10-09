export class PluginManifest {
  constructor(input = {}) {
    const { id, version, apiVersion = '1', capabilities = [], permissions = [], dependencies = [], isolation = 'in-process', metadata = {} } = input;
    if (!id || typeof id !== 'string') throw new TypeError('PluginManifest: id is required');
    if (!version || typeof version !== 'string') throw new TypeError(`PluginManifest(${id}): version is required`);
    if (!Array.isArray(capabilities) || capabilities.some((v) => typeof v !== 'string')) throw new TypeError(`PluginManifest(${id}): capabilities must be string[]`);
    if (!Array.isArray(permissions) || permissions.some((v) => typeof v !== 'string')) throw new TypeError(`PluginManifest(${id}): permissions must be string[]`);
    if (!Array.isArray(dependencies)) throw new TypeError(`PluginManifest(${id}): dependencies must be an array`);
    this.id = id; this.version = version; this.apiVersion = apiVersion;
    this.capabilities = [...new Set(capabilities)]; this.permissions = [...new Set(permissions)];
    this.dependencies = dependencies; this.isolation = isolation; this.metadata = { ...metadata };
    Object.freeze(this.capabilities); Object.freeze(this.permissions); Object.freeze(this.dependencies); Object.freeze(this.metadata); Object.freeze(this);
  }
}
export function normalizeManifest(input) { return input instanceof PluginManifest ? input : new PluginManifest(input); }
