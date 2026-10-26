/**
 * Br3eze OS Level 2: platform-neutral adapter boundary.
 * Platform-specific packages implement this contract; shared applications
 * depend on capability names and results, never OS-specific objects.
 */
const ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/i;

function assertId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new TypeError(`${label} must be a stable identifier`);
}

function normalizeCapability(capability, adapterId) {
  if (!capability || typeof capability !== 'object' || Array.isArray(capability)) throw new TypeError('platform capability must be an object');
  assertId(capability.name, 'capability.name');
  if (typeof capability.invoke !== 'function') throw new TypeError(`platform capability ${capability.name} requires invoke()`);
  const access = capability.access || 'read';
  if (access !== 'read' && access !== 'write') throw new TypeError('platform capability access must be read or write');
  const platforms = capability.platforms || ['any'];
  if (!Array.isArray(platforms) || platforms.length === 0 || platforms.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new TypeError('capability.platforms must be a non-empty array of platform names');
  }
  return Object.freeze({
    id: `platform.${adapterId}.${capability.name}`,
    name: capability.name,
    adapterId,
    access,
    description: typeof capability.description === 'string' ? capability.description : '',
    platforms: Object.freeze([...new Set(platforms)]),
    invoke: capability.invoke,
  });
}

/**
 * Registry for portable host capabilities. This is an adapter boundary, not
 * a kernel or security sandbox; callers must compose it behind runtime policy.
 */
export class PlatformAdapterRegistry {
  constructor({ maxAdapters = 128 } = {}) {
    if (!Number.isInteger(maxAdapters) || maxAdapters < 1 || maxAdapters > 4096) throw new RangeError('maxAdapters must be an integer between 1 and 4096');
    this.maxAdapters = maxAdapters;
    this.adapters = new Map();
    this.capabilities = new Map();
  }

  register(adapter) {
    if (!adapter || typeof adapter !== 'object') throw new TypeError('platform adapter is required');
    assertId(adapter.id, 'adapter.id');
    if (this.adapters.has(adapter.id)) throw new Error(`platform adapter already registered: ${adapter.id}`);
    if (this.adapters.size >= this.maxAdapters) throw new Error('platform adapter limit reached');
    if (!Array.isArray(adapter.capabilities) || adapter.capabilities.length === 0) throw new TypeError('platform adapter must declare at least one capability');
    for (const method of ['start', 'stop']) {
      if (adapter[method] !== undefined && typeof adapter[method] !== 'function') throw new TypeError(`adapter.${method} must be a function`);
    }

    const pending = adapter.capabilities.map((capability) => normalizeCapability(capability, adapter.id));
    const names = new Set();
    for (const capability of pending) {
      if (names.has(capability.id) || this.capabilities.has(capability.id)) throw new Error(`platform capability already registered: ${capability.id}`);
      names.add(capability.id);
    }
    const record = { adapter, state: 'created', startedAt: null, lastError: null, capabilities: pending, startPromise: null, stopPromise: null };
    this.adapters.set(adapter.id, record);
    for (const capability of pending) this.capabilities.set(capability.id, capability);
    return this.describeAdapter(adapter.id);
  }

  async start(adapterId, context = {}) {
    const record = this.#requireAdapter(adapterId);
    if (record.state === 'ready') return this.describeAdapter(adapterId);
    if (record.state === 'starting') return record.startPromise;
    if (record.state === 'stopping') throw new Error(`platform adapter is stopping: ${adapterId}`);
    record.state = 'starting';
    record.lastError = null;
    record.startPromise = (async () => {
      try {
        await record.adapter.start?.(context);
        record.state = 'ready';
        record.startedAt = Date.now();
        return this.describeAdapter(adapterId);
      } catch (error) {
        record.state = 'failed';
        record.lastError = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        record.startPromise = null;
      }
    })();
    return record.startPromise;
  }

  async stop(adapterId, context = {}) {
    const record = this.#requireAdapter(adapterId);
    if (record.state === 'stopped' || record.state === 'created') {
      record.state = 'stopped';
      return this.describeAdapter(adapterId);
    }
    if (record.state === 'stopping') return record.stopPromise;
    if (record.state === 'starting' && record.startPromise) {
      try { await record.startPromise; } catch { return this.describeAdapter(adapterId); }
    }
    record.state = 'stopping';
    record.stopPromise = (async () => {
      try {
        await record.adapter.stop?.(context);
        record.state = 'stopped';
        record.startedAt = null;
        return this.describeAdapter(adapterId);
      } catch (error) {
        record.state = 'failed';
        record.lastError = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        record.stopPromise = null;
      }
    })();
    return record.stopPromise;
  }

  async invoke(capabilityId, input = {}, context = {}) {
    const capability = this.capabilities.get(capabilityId);
    if (!capability) throw new Error(`platform capability not found: ${capabilityId}`);
    const record = this.#requireAdapter(capability.adapterId);
    if (record.state !== 'ready') throw new Error(`platform adapter is not ready: ${capability.adapterId}`);
    if (!context.tenantId || !context.userId) throw new Error('platform invocation requires authenticated tenant and user context');
    const grants = Array.isArray(context.authorizedCapabilities) ? context.authorizedCapabilities : context.capabilities;
    const requiredGrant = `platform:${capability.adapterId}:${capability.name}`;
    if (!Array.isArray(grants) || !grants.includes(requiredGrant)) throw new Error(`missing_permission:${requiredGrant}`);
    if (capability.access === 'write' && context.approvalGranted !== true) throw new Error(`explicit approval required: ${capabilityId}`);
    if (context.signal?.aborted) throw context.signal.reason || new Error('platform operation cancelled');
    return capability.invoke(input, {
      signal: context.signal,
      requestId: context.requestId,
      tenantId: context.tenantId,
      userId: context.userId,
      platform: context.platform || 'unknown',
      adapterId: capability.adapterId,
      capabilityId,
      approved: capability.access !== 'write' || context.approvalGranted === true,
    });
  }

  listCapabilities({ platform } = {}) {
    return [...this.capabilities.values()]
      .filter((capability) => !platform || capability.platforms.includes('any') || capability.platforms.includes(platform))
      .map(({ invoke, ...metadata }) => ({ ...metadata, state: this.adapters.get(metadata.adapterId)?.state || 'failed' }));
  }

  describeAdapter(adapterId) {
    const record = this.#requireAdapter(adapterId);
    return { id: adapterId, state: record.state, startedAt: record.startedAt, lastError: record.lastError, capabilities: record.capabilities.map(({ id }) => id) };
  }

  listAdapters() { return [...this.adapters.keys()].map((id) => this.describeAdapter(id)); }

  #requireAdapter(adapterId) {
    const record = this.adapters.get(adapterId);
    if (!record) throw new Error(`platform adapter not found: ${adapterId}`);
    return record;
  }
}

export default PlatformAdapterRegistry;
