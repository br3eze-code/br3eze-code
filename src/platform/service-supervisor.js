import { EventEmitter } from 'node:events';

const ID = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/;
const ACTIVE_STATES = new Set(['starting', 'running', 'stopping']);

function normalizeError(error) {
  return String(error?.message || error);
}

/**
 * Supervises services without binding the runtime to a particular host.
 * Dependencies must be running before startup; dependents are stopped first.
 */
export class ServiceSupervisor extends EventEmitter {
  #services = new Map();

  register(id, service, { dependencies = [] } = {}) {
    if (typeof id !== 'string' || !ID.test(id)) {
      throw new TypeError('service id is invalid');
    }
    if (!service || typeof service.start !== 'function' || typeof service.stop !== 'function') {
      throw new TypeError('service must implement start(context) and stop(context)');
    }
    if (this.#services.has(id)) throw new Error(`Service already registered: ${id}`);
    if (!Array.isArray(dependencies) || dependencies.some((dependency) => typeof dependency !== 'string' || !ID.test(dependency))) {
      throw new TypeError('dependencies must be an array of valid service ids');
    }
    if (dependencies.includes(id)) throw new TypeError('a service cannot depend on itself');

    const normalizedDependencies = [...new Set(dependencies)];
    this.#services.set(id, {
      id,
      service,
      dependencies: normalizedDependencies,
      state: 'registered',
      lastError: null,
    });

    try {
      this.#assertAcyclic();
    } catch (error) {
      this.#services.delete(id);
      throw error;
    }

    this.emit('service:registered', this.status(id));
    return this.status(id);
  }

  status(id) {
    const item = this.#services.get(id);
    if (!item) return null;
    return Object.freeze({
      id: item.id,
      state: item.state,
      dependencies: [...item.dependencies],
      lastError: item.lastError,
    });
  }

  list() {
    return [...this.#services.keys()].map((id) => this.status(id));
  }

  async start(id, context = {}) {
    const item = this.#require(id);
    if (item.state === 'running') return this.status(id);
    if (ACTIVE_STATES.has(item.state)) {
      throw new Error(`Invalid lifecycle transition for ${id}: ${item.state}`);
    }

    for (const dependency of item.dependencies) {
      const dep = this.#require(dependency);
      if (dep.state !== 'running') throw new Error(`Dependency not running: ${dependency}`);
    }

    item.state = 'starting';
    item.lastError = null;
    this.emit('service:state', this.status(id));

    try {
      await item.service.start(Object.freeze({ ...context, serviceId: id }));
      item.state = 'running';
      this.emit('service:state', this.status(id));
      return this.status(id);
    } catch (error) {
      item.state = 'failed';
      item.lastError = normalizeError(error);
      this.emit('service:state', this.status(id));
      throw error;
    }
  }

  async stop(id, context = {}) {
    const item = this.#require(id);
    if (item.state === 'stopped' || item.state === 'registered') {
      item.state = 'stopped';
      return this.status(id);
    }
    if (item.state !== 'running' && item.state !== 'failed') {
      throw new Error(`Invalid lifecycle transition for ${id}: ${item.state}`);
    }

    const activeDependents = [...this.#services.values()]
      .filter((candidate) => candidate.dependencies.includes(id) && ACTIVE_STATES.has(candidate.state))
      .map((candidate) => candidate.id);
    if (activeDependents.length) {
      throw new Error(`Cannot stop ${id}; active dependents: ${activeDependents.join(', ')}`);
    }

    item.state = 'stopping';
    this.emit('service:state', this.status(id));
    try {
      await item.service.stop(Object.freeze({ ...context, serviceId: id }));
      item.state = 'stopped';
      item.lastError = null;
      this.emit('service:state', this.status(id));
      return this.status(id);
    } catch (error) {
      item.state = 'failed';
      item.lastError = normalizeError(error);
      this.emit('service:state', this.status(id));
      throw error;
    }
  }

  async stopAll(context = {}) {
    const order = this.#shutdownOrder();
    const results = [];
    for (const id of order) {
      const item = this.#services.get(id);
      if (item.state !== 'running' && item.state !== 'failed') continue;
      try {
        results.push(await this.stop(id, context));
      } catch (error) {
        results.push({ id, state: 'failed', error: normalizeError(error) });
      }
    }
    return results;
  }

  #shutdownOrder() {
    const visited = new Set();
    const order = [];
    const visit = (id) => {
      if (visited.has(id)) return;
      visited.add(id);
      const item = this.#services.get(id);
      if (!item) return;
      for (const candidate of this.#services.values()) {
        if (candidate.dependencies.includes(id)) visit(candidate.id);
      }
      order.push(id);
    };
    for (const id of this.#services.keys()) visit(id);
    return order;
  }

  #assertAcyclic() {
    const visiting = new Set();
    const visited = new Set();
    const visit = (id, trail) => {
      if (visiting.has(id)) throw new Error(`Service dependency cycle: ${[...trail, id].join(' -> ')}`);
      if (visited.has(id)) return;
      visiting.add(id);
      const item = this.#services.get(id);
      for (const dependency of item?.dependencies ?? []) {
        if (this.#services.has(dependency)) visit(dependency, [...trail, id]);
      }
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of this.#services.keys()) visit(id, []);
  }

  #require(id) {
    const item = this.#services.get(id);
    if (!item) throw new Error(`Unknown service: ${id}`);
    return item;
  }
}
