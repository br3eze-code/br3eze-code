const ID = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/;
const PROVIDER_KINDS = new Set(['model', 'storage', 'network', 'hardware', 'messaging', 'identity', 'custom']);

function validateProvider(provider) {
  if (!provider || typeof provider !== 'object') throw new TypeError('provider must be an object');
  if (typeof provider.id !== 'string' || !ID.test(provider.id)) throw new TypeError('provider.id is invalid');
  if (!PROVIDER_KINDS.has(provider.kind)) throw new TypeError(`provider.kind must be one of: ${[...PROVIDER_KINDS].join(', ')}`);
  if (typeof provider.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(provider.version)) throw new TypeError('provider.version must be semantic version X.Y.Z');
  if (!Array.isArray(provider.capabilities) || provider.capabilities.some((c) => typeof c !== 'string' || !c.trim())) throw new TypeError('provider.capabilities must be an array of non-empty strings');
  return provider;
}

/**
 * Service-Provider-Interface registry inspired by JVM service providers.
 * Registration is explicit: importing a module never silently grants authority.
 */
export class ProviderRegistry {
  #providers = new Map();

  register(provider) {
    validateProvider(provider);
    if (this.#providers.has(provider.id)) throw new Error(`Provider already registered: ${provider.id}`);
    const record = Object.freeze({
      id: provider.id,
      kind: provider.kind,
      version: provider.version,
      capabilities: Object.freeze([...new Set(provider.capabilities)]),
      implementation: provider,
      priority: Number.isFinite(provider.priority) ? provider.priority : 0,
    });
    this.#providers.set(record.id, record);
    return this.describe(record.id);
  }

  unregister(id) { return this.#providers.delete(id); }

  get(id) { return this.#providers.get(id)?.implementation ?? null; }

  describe(id) {
    const item = this.#providers.get(id);
    if (!item) return null;
    return Object.freeze({ id: item.id, kind: item.kind, version: item.version, capabilities: [...item.capabilities], priority: item.priority });
  }

  list({ kind, capability } = {}) {
    return [...this.#providers.values()]
      .filter((p) => !kind || p.kind === kind)
      .filter((p) => !capability || p.capabilities.includes(capability))
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
      .map((p) => this.describe(p.id));
  }

  resolve({ kind, capability, preferredId } = {}) {
    if (preferredId) {
      const preferred = this.#providers.get(preferredId);
      if (preferred && (!kind || preferred.kind === kind) && (!capability || preferred.capabilities.includes(capability))) return preferred.implementation;
    }
    const match = this.list({ kind, capability })[0];
    return match ? this.get(match.id) : null;
  }
}
