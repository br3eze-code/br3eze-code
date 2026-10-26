import { EventEmitter } from 'node:events';

const VALID_STATES = new Set(['registered', 'starting', 'running', 'stopping', 'stopped', 'failed']);

export class ServiceSupervisor extends EventEmitter {
  #services = new Map();

  register(id, service, { dependencies = [] } = {}) {
    if (typeof id !== 'string' || !/^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/.test(id)) throw new TypeError('service id is invalid');
    if (!service || typeof service.start !== 'function' || typeof service.stop !== 'function') {
      throw new TypeError('service must implement start(context) and stop(context)');
    }
    if (this.#services.has(id)) throw new Error(`Service already registered: ${id}`);
    if (!Array.isArray(dependencies) || dependencies.includes(id)) throw new TypeError('dependencies must be an array and cannot include the service itself');
    this.#services.set(id, { id, service, dependencies: [...new Set(dependencies)], state: 'registered', lastError: null });
    this.emit('service:registered', this.status(id));
    return this.status(id);
  }

  status(id) {
    const item = this.#services.get(id);
    if (!item) return null;
    return Object.freeze({ id: item.id, state: item.state, dependencies: [...item.dependencies], lastError: item.lastError });
  }

  list() { return [...this.#services.keys()].map((id) => this.status(id)); }

  async start(id, context = {}) {
    const item = this.#require(id);
    if (item.state === 'running') return this.status(id);
    if (item.state === 'starting' || item.state === 'stopping') throw new Error(`Invalid lifecycle transition for ${id}: ${item.state}`);
    for (const dependency of item.dependencies) {
      const dep = this.#require(dependency);
      if (dep.state !== 'running') throw new Error(`Dependency not running: ${dependency}`);
    }
    item.state = 'starting'; item.lastError = null; this.emit('service:state', this.status(id));
    try {
      await item.service.start(Object.freeze({ ...context, serviceId: id }));
      item.state = 'running';
      this.emit('service:state', this.status(id));
      return this.status(id);
    } catch (error) {
      item.state = 'failed'; item.lastError = String(error?.message || error);
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
    if (item.state !== 'running' && item.state !== 'failed') throw new Error(`Invalid lifecycle transition for ${id}: ${item.state}`);
    item.state = 'stopping'; this.emit('service:state', this.status(id));
    try {
      await item.service.stop(Object.freeze({ ...context, serviceId: id }));
      item.state = 'stopped'; item.lastError = null;
      this.emit('service:state', this.status(id));
      return this.status(id);
    } catch (error) {
      item.state = 'failed'; item.lastError = String(error?.message || error);
      this.emit('service:state', this.status(id));
      throw error;
    }
  }

  async stopAll(context = {}) {
    const running = [...this.#services.values()].filter((item) => item.state === 'running').map((item) => item.id);
    const stopped = [];
    for (const id of running.reverse()) {
      try { stopped.push(await this.stop(id, context)); }
      catch (error) { stopped.push({ id, state: 'failed', error: String(error?.message || error) }); }
    }
    return stopped;
  }

  #require(id) {
    const item = this.#services.get(id);
    if (!item) throw new Error(`Unknown service: ${id}`);
    return item;
  }
}
