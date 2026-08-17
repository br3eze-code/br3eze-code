const REQUIRED_ADAPTER_FIELDS = ['type', 'version', 'capabilities', 'execute'];

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value.trim();
}

function assertCapability(capability) {
  if (!capability || typeof capability !== 'object') throw new TypeError('capability must be an object');
  requiredString(capability.name, 'capability.name');
  if (typeof capability.inputSchema !== 'object' || capability.inputSchema === null) throw new TypeError('capability.inputSchema is required');
  return Object.freeze({ ...capability });
}

export const CORE_ENTITY_TYPES = Object.freeze([
  'organisation', 'principal', 'role', 'function', 'project', 'assignment', 'skill',
  'capability', 'authority', 'capacity', 'policy', 'workflow', 'resource', 'tool',
  'work', 'loop', 'action', 'evidence', 'outcome', 'audit'
]);

export function assertDomainAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('adapter is required');
  for (const field of REQUIRED_ADAPTER_FIELDS) {
    if (!(field in adapter)) throw new TypeError(`adapter.${field} is required`);
  }
  const type = requiredString(adapter.type, 'adapter.type');
  const version = requiredString(adapter.version, 'adapter.version');
  if (!Array.isArray(adapter.capabilities) || adapter.capabilities.length === 0) {
    throw new TypeError('adapter.capabilities must be a non-empty array');
  }
  if (typeof adapter.execute !== 'function') throw new TypeError('adapter.execute must be a function');
  const capabilities = adapter.capabilities.map(assertCapability);
  return Object.freeze({ ...adapter, type, version, capabilities });
}

export class DomainAdapterRegistry {
  #adapters = new Map();

  register(adapter) {
    const validated = assertDomainAdapter(adapter);
    if (this.#adapters.has(validated.type)) throw new Error(`domain adapter already registered: ${validated.type}`);
    this.#adapters.set(validated.type, validated);
    return validated.type;
  }

  get(type) {
    return this.#adapters.get(type) || null;
  }

  list() {
    return [...this.#adapters.values()];
  }

  async execute({ adapterType, capability, input, context }) {
    const adapter = this.get(requiredString(adapterType, 'adapterType'));
    if (!adapter) throw Object.assign(new Error('domain adapter unavailable'), { code: 'ADAPTER_UNAVAILABLE' });
    const declared = adapter.capabilities.find(item => item.name === capability);
    if (!declared) throw Object.assign(new Error('adapter capability unavailable'), { code: 'CAPABILITY_UNAVAILABLE' });
    if (!context || typeof context !== 'object' || !context.tenantId || !context.workId || !context.actionId) {
      throw Object.assign(new Error('scoped execution context is required'), { code: 'EXECUTION_CONTEXT_REQUIRED' });
    }
    return adapter.execute({ capability, input, context });
  }
}

export default DomainAdapterRegistry;
