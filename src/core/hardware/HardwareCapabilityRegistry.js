import { randomUUID } from 'node:crypto';

const NAME = /^[a-z][a-z0-9_-]{0,47}$/i;
const ACCESS = new Set(['read', 'write']);

function assertName(value, label) {
  if (typeof value !== 'string' || !NAME.test(value)) {
    throw new TypeError(`${label} must be a simple identifier (letters, digits, _ or -)`);
  }
}

function normalizeSchema(schema = {}) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new TypeError('hardware capability schema must be an object');
  }
  return schema;
}

function validateArguments(schema, args) {
  if (schema.type && schema.type !== 'object') throw new TypeError('hardware capability schema root must be an object');
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new TypeError('hardware capability arguments must be an object');
  }
  for (const key of schema.required || []) {
    if (!Object.prototype.hasOwnProperty.call(args, key)) throw new TypeError(`missing required hardware argument: ${key}`);
  }
  const properties = schema.properties || {};
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(args)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) throw new TypeError(`unknown hardware argument: ${key}`);
    }
  }
  for (const [key, value] of Object.entries(args)) {
    const rule = properties[key];
    if (!rule) continue;
    const types = {
      object: value !== null && typeof value === 'object' && !Array.isArray(value),
      array: Array.isArray(value),
      integer: Number.isInteger(value),
      number: typeof value === 'number' && Number.isFinite(value),
      null: value === null,
      string: typeof value === 'string',
      boolean: typeof value === 'boolean',
    };
    if (rule.type && !types[rule.type]) throw new TypeError(`invalid type for hardware argument: ${key}`);
    if (rule.enum && !rule.enum.some((allowed) => Object.is(allowed, value))) {
      throw new TypeError(`invalid value for hardware argument: ${key}`);
    }
    if (typeof value === 'number' && ((rule.minimum !== undefined && value < rule.minimum) || (rule.maximum !== undefined && value > rule.maximum))) {
      throw new TypeError(`out-of-range hardware argument: ${key}`);
    }
    if (typeof value === 'string' && rule.maxLength !== undefined && value.length > rule.maxLength) {
      throw new TypeError(`hardware argument too long: ${key}`);
    }
  }
}

/**
 * Domain-neutral hardware capability port.
 *
 * Adapters own device-specific I/O. The runtime only sees declared capabilities;
 * arbitrary shell commands, raw device paths and undeclared operations are not
 * accepted by this boundary.
 */
export class HardwareCapabilityRegistry {
  constructor({ timeoutMs = 15_000, maxAdapters = 64 } = {}) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
      throw new RangeError('timeoutMs must be an integer between 1 and 120000');
    }
    this.timeoutMs = timeoutMs;
    if (!Number.isInteger(maxAdapters) || maxAdapters < 1 || maxAdapters > 1024) {
      throw new RangeError('maxAdapters must be an integer between 1 and 1024');
    }
    this.maxAdapters = maxAdapters;
    this.adapters = new Map();
    this.capabilities = new Map();
    this.mountedRegistries = new WeakMap();
  }

  registerAdapter(adapter) {
    if (!adapter || typeof adapter !== 'object') throw new TypeError('hardware adapter is required');
    assertName(adapter.id, 'adapter.id');
    if (this.adapters.has(adapter.id)) throw new Error(`Hardware adapter already registered: ${adapter.id}`);
    if (this.adapters.size >= this.maxAdapters) throw new Error('hardware adapter limit reached');
    if (!Array.isArray(adapter.capabilities) || adapter.capabilities.length === 0) {
      throw new TypeError('adapter.capabilities must be a non-empty array');
    }

    const seen = new Set();
    const pending = adapter.capabilities.map((capability) => {
      if (!capability || typeof capability !== 'object') throw new TypeError('capability must be an object');
      assertName(capability.name, 'capability.name');
      if (!ACCESS.has(capability.access)) throw new TypeError('capability.access must be read or write');
      if (typeof capability.execute !== 'function') throw new TypeError('capability.execute must be a function');
      const fullName = `hardware.${adapter.id}.${capability.name}`;
      if (this.capabilities.has(fullName) || seen.has(fullName)) {
        throw new Error(`Hardware capability already registered: ${fullName}`);
      }
      seen.add(fullName);
      return { fullName, adapter, capability: { ...capability, schema: normalizeSchema(capability.schema) } };
    });

    for (const entry of pending) this.capabilities.set(entry.fullName, entry);
    this.adapters.set(adapter.id, adapter);
    return this;
  }

  unregisterAdapter(adapterId) {
    const adapter = this.adapters.get(adapterId);
    if (!adapter) return false;
    for (const [name, entry] of this.capabilities) {
      if (entry.adapter === adapter) this.capabilities.delete(name);
    }
    this.adapters.delete(adapterId);
    return true;
  }

  listCapabilities() {
    return [...this.capabilities.values()].map(({ fullName, adapter, capability }) => ({
      name: fullName,
      adapterId: adapter.id,
      description: capability.description || '',
      access: capability.access,
      schema: capability.schema,
      requiresApproval: capability.access === 'write' || capability.requiresApproval === true,
    }));
  }

  /** Register declared capabilities in the one canonical ToolRegistry. */
  mount(toolRegistry) {
    if (!toolRegistry || typeof toolRegistry.register !== 'function') {
      throw new TypeError('canonical ToolRegistry with register() is required');
    }
    let mounted = this.mountedRegistries.get(toolRegistry);
    if (!mounted) { mounted = new Set(); this.mountedRegistries.set(toolRegistry, mounted); }
    for (const { fullName, adapter, capability } of this.capabilities.values()) {
      if (mounted.has(fullName)) continue;
      toolRegistry.register(fullName, {
        description: capability.description || `Hardware capability ${fullName}`,
        schema: {
          description: capability.description || `Hardware capability ${fullName}`,
          parameters: capability.schema,
          risk: capability.access === 'write' ? 'high' : 'low',
          requiresApproval: capability.access === 'write' || capability.requiresApproval === true,
          permissions: [`hardware:${adapter.id}:${capability.name}`],
        },
        capabilityId: fullName,
        requiresApproval: capability.access === 'write' || capability.requiresApproval === true,
        passContext: true,
        execute: (args, context) => this.execute(fullName, args, context),
      });
      mounted.add(fullName);
    }
    return this;
  }

  async execute(fullName, args = {}, context = {}) {
    const entry = this.capabilities.get(fullName);
    if (!entry) throw new Error(`Hardware capability not found: ${fullName}`);

    const tenantId = context.tenantId || context.tenant_id;
    const userId = context.userId || context.user_id || context.uid;
    if (!tenantId || !userId) throw new Error('authenticated tenant and user are required for hardware access');
    if (entry.capability.access === 'write' && (context.approvalGranted !== true || typeof context.approvalId !== 'string' || !context.approvalId.trim())) {
      throw new Error(`hardware write requires explicit approval: ${fullName}`);
    }

    validateArguments(entry.capability.schema, args);

    const controller = new AbortController();
    let timeout;
    const timeoutFailure = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        const error = new Error(`hardware operation timed out after ${this.timeoutMs}ms`);
        controller.abort(error);
        reject(error);
      }, this.timeoutMs);
    });
    const signal = context.signal;
    const abortFromCaller = () => controller.abort(signal.reason || new Error('hardware operation cancelled'));
    let rejectAbort;
    const onControllerAbort = () => rejectAbort?.(controller.signal.reason || new Error('hardware operation cancelled'));
    const abortFailure = new Promise((_, reject) => { rejectAbort = reject; });
    controller.signal.addEventListener('abort', onControllerAbort, { once: true });
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener('abort', abortFromCaller, { once: true });

    const operationId = randomUUID();
    try {
      if (controller.signal.aborted) throw controller.signal.reason || new Error('hardware operation cancelled');
      const operation = Promise.resolve().then(() => entry.capability.execute(args, {
        tenantId,
        userId,
        deviceId: entry.adapter.deviceId || entry.adapter.id,
        adapterId: entry.adapter.id,
        capability: fullName,
        operationId,
        signal: controller.signal,
        approved: entry.capability.access === 'write' && context.approvalGranted === true,
        approvalId: context.approvalId || null,
      }));
      return await Promise.race([operation, timeoutFailure, abortFailure]);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortFromCaller);
      controller.signal.removeEventListener('abort', onControllerAbort);
    }
  }
}


export default HardwareCapabilityRegistry;
