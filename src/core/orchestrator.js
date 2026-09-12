import { logger } from './logger.js';

/**
 * Domain-agnostic AgentOS lifecycle orchestrator.
 *
 * Core owns scheduling, lifecycle and observation. Domain/infrastructure
 * behavior is injected through capabilities; the kernel does not know about
 * a particular vendor, protocol, network product or commerce implementation.
 */
class AgentOSOrchestrator {
  constructor(capabilities = {}, db = null, gateway = null, notifier = null) {
    // Backwards-compatible positional construction is retained, but the core
    // treats the first argument strictly as an injected capability provider.
    this.capabilities = capabilities || {};
    this.db = db;
    this.gateway = gateway;
    this.notifier = notifier;
    this._knownEntities = new Set();
    this._intervals = [];
    this._started = false;
  }

  _capability(name) {
    const value = this.capabilities?.[name];
    return typeof value === 'function' ? value.bind(this.capabilities) : null;
  }

  async _call(name, ...args) {
    const capability = this._capability(name);
    if (!capability) return undefined;
    return capability(...args);
  }

  start() {
    if (this._started) return this;
    this._started = true;
    logger.info('AgentOSOrchestrator: starting lifecycle services');
    this._provision().catch((error) => logger.error(`Provisioning error: ${error.message}`));
    this._monitorSystem();
    this._monitorEntities();
    this._scheduleExpiry();
    this._scheduleMaintenance();
    return this;
  }

  stop() {
    for (const interval of this._intervals) clearInterval(interval);
    this._intervals = [];
    this._started = false;
  }

  async _provision() {
    await this._call('provision');
  }

  _monitorSystem() {
    const interval = setInterval(async () => {
      try {
        const metrics = await this._call('getSystemMetrics');
        if (metrics !== undefined) {
          await this._call('observeSystem', metrics);
          this.gateway?.broadcast?.({ type: 'system.observed', metrics });
        }
      } catch (error) {
        logger.error(`System monitor: ${error.message}`);
      }
    }, 15_000);
    this._intervals.push(interval);
  }

  _monitorEntities() {
    const interval = setInterval(async () => {
      try {
        const entities = await this._call('listEntities');
        if (!Array.isArray(entities)) return;

        for (const entity of entities) {
          const id = entity?.id ?? entity?.key ?? entity?.name;
          if (id == null || this._knownEntities.has(String(id))) continue;
          this._knownEntities.add(String(id));
          await this._call('onNewEntity', entity);
          if (this._knownEntities.size > 1) {
            this.notifier?.alertOnce?.(`new-entity-${id}`, { type: 'entity.new', entity });
          }
        }
      } catch (error) {
        logger.warn(`Entity monitor: ${error.message}`);
      }
    }, 60_000);
    this._intervals.push(interval);
  }

  _scheduleExpiry() {
    const interval = setInterval(async () => {
      try {
        const expire = this._capability('expire');
        if (!expire) return;
        const result = await expire();
        if (result == null) return;
        this.gateway?.broadcast?.({ type: 'lifecycle.expired', result });
        await this._call('onExpired', result);
      } catch (error) {
        logger.error(`Expiry task: ${error.message}`);
      }
    }, 60 * 60_000);
    this._intervals.push(interval);
  }

  _scheduleMaintenance() {
    const interval = setInterval(async () => {
      try {
        const maintenance = this._capability('maintenance');
        if (!maintenance) return;
        const result = await maintenance();
        this.gateway?.broadcast?.({ type: 'maintenance.completed', result });
        this.notifier?.sendToAll?.({ type: 'maintenance.completed', result });
      } catch (error) {
        logger.error(`Maintenance task: ${error.message}`);
      }
    }, 60 * 60_000);
    this._intervals.push(interval);
  }
}

export default AgentOSOrchestrator;
export { AgentOSOrchestrator };
