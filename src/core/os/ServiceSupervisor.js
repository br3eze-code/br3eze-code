const SERVICE_ID = /^[a-z][a-z0-9._-]{0,95}$/i;
const TERMINAL = new Set(['stopped', 'failed']);

function assertService(service) {
  if (!service || typeof service !== 'object' || typeof service.id !== 'string' || !SERVICE_ID.test(service.id)) {
    throw new TypeError('service.id must be a stable identifier');
  }
  if (typeof service.start !== 'function' || typeof service.stop !== 'function') {
    throw new TypeError('service must implement start(context) and stop(context)');
  }
  return service;
}

/** In-process lifecycle supervisor. It supervises trusted host services; it is not a process sandbox. */
export class ServiceSupervisor {
  constructor({ maxServices = 256, onEvent = () => {} } = {}) {
    if (!Number.isInteger(maxServices) || maxServices < 1 || maxServices > 10000) throw new RangeError('maxServices must be between 1 and 10000');
    if (typeof onEvent !== 'function') throw new TypeError('onEvent must be a function');
    this.maxServices = maxServices;
    this.onEvent = onEvent;
    this.services = new Map();
  }

  register(service) {
    assertService(service);
    if (this.services.has(service.id)) throw new Error(`service already registered: ${service.id}`);
    if (this.services.size >= this.maxServices) throw new Error('service limit reached');
    const record = { service, state: 'stopped', startedAt: null, lastError: null, transition: null };
    this.services.set(service.id, record);
    this.#emit(record, 'registered');
    return this.describe(service.id);
  }

  async start(id, context = {}) {
    const record = this.#require(id);
    if (record.state === 'running') return this.describe(id);
    if (record.state === 'starting') return record.transition;
    if (record.state === 'stopping') throw new Error(`service is stopping: ${id}`);
    record.state = 'starting'; record.lastError = null; this.#emit(record, 'starting');
    record.transition = (async () => {
      try {
        await record.service.start(context);
        record.state = 'running'; record.startedAt = new Date().toISOString();
        this.#emit(record, 'running');
        return this.describe(id);
      } catch (error) {
        record.state = 'failed'; record.lastError = error instanceof Error ? error.message : String(error);
        this.#emit(record, 'failed');
        throw error;
      } finally { record.transition = null; }
    })();
    return record.transition;
  }

  async stop(id, context = {}) {
    const record = this.#require(id);
    if (record.state === 'stopped') return this.describe(id);
    if (record.state === 'stopping') return record.transition;
    if (record.state === 'starting' && record.transition) {
      try { await record.transition; } catch { return this.describe(id); }
    }
    if (record.state !== 'running' && record.state !== 'failed') {
      record.state = 'stopped';
      return this.describe(id);
    }
    record.state = 'stopping'; this.#emit(record, 'stopping');
    record.transition = (async () => {
      try {
        await record.service.stop(context);
        record.state = 'stopped'; record.startedAt = null; record.lastError = null;
        this.#emit(record, 'stopped');
        return this.describe(id);
      } catch (error) {
        record.state = 'failed'; record.lastError = error instanceof Error ? error.message : String(error);
        this.#emit(record, 'failed');
        throw error;
      } finally { record.transition = null; }
    })();
    return record.transition;
  }

  async stopAll(context = {}) {
    const results = [];
    for (const id of [...this.services.keys()].reverse()) {
      try { results.push(await this.stop(id, context)); }
      catch (error) { results.push({ id, state: 'failed', error: error.message }); }
    }
    return results;
  }

  describe(id) {
    const { service, ...record } = this.#require(id);
    return { id, state: record.state, startedAt: record.startedAt, lastError: record.lastError, metadata: service.metadata || {} };
  }

  list() { return [...this.services.keys()].map((id) => this.describe(id)); }

  #require(id) {
    const record = this.services.get(id);
    if (!record) throw new Error(`service not found: ${id}`);
    return record;
  }

  #emit(record, event) {
    try { this.onEvent({ type: 'service.lifecycle', serviceId: record.service.id, state: record.state, event, at: new Date().toISOString() }); }
    catch { /* Observability failures must not break lifecycle transitions. */ }
  }
}

export default ServiceSupervisor;
