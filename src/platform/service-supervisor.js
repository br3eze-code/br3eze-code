import { EventEmitter } from 'node:events';
import { ServiceSupervisor as CoreServiceSupervisor } from '../core/os/ServiceSupervisor.js';

/**
 * Backwards-compatible platform API.
 * Lifecycle state, transitions, dependency graph and shutdown ordering are
 * owned by core/os/ServiceSupervisor; this adapter only preserves the older
 * (id, service, options) call shape.
 */
export class ServiceSupervisor extends EventEmitter {
  constructor({ maxServices = 256, onEvent = () => {} } = {}) {
    super();
    if (typeof onEvent !== 'function') throw new TypeError('onEvent must be a function');
    this.core = new CoreServiceSupervisor({
      maxServices,
      onEvent: (event) => {
        try { onEvent(event); } catch {}
        this.emit(event.event === 'registered' ? 'service:registered' : 'service:state', this.status(event.serviceId));
      },
    });
  }

  register(id, service, options = {}) {
    if (typeof id !== 'string') throw new TypeError('service id is invalid');
    if (!service || typeof service !== 'object') throw new TypeError('service must implement start(context) and stop(context)');
    return this.core.register({ ...service, id }, options);
  }

  status(id) { return this.core.status(id); }
  describe(id) { return this.core.describe(id); }
  list() { return this.core.list(); }
  start(id, context) { return this.core.start(id, context); }
  stop(id, context) { return this.core.stop(id, context); }
  stopAll(context) { return this.core.stopAll(context); }
}

export default ServiceSupervisor;
