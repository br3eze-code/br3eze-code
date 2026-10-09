import { logger } from './logger.js';

/**
 * Domain-neutral orchestration scheduler.
 * Domain behavior is supplied as tasks/callbacks; Core owns lifecycle only.
 */
export default class AgentOSOrchestrator {
  constructor({ tasks = [], eventBus = null, clock = () => new Date() } = {}) {
    this.tasks = new Map();
    this.eventBus = eventBus;
    this.clock = clock;
    this._timers = new Map();
    for (const task of tasks) this.register(task);
  }
  register(task) {
    if (!task?.id || typeof task.run !== 'function') throw new TypeError('Task requires id and run()');
    if (this.tasks.has(task.id)) throw new Error(`Task already registered: ${task.id}`);
    this.tasks.set(task.id, { ...task });
    return task.id;
  }
  unregister(id) { this.stop(id); return this.tasks.delete(id); }
  async run(id, context = {}) {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    const startedAt = Date.now();
    try {
      const result = await task.run({ ...context, now: this.clock(), taskId: id });
      this.eventBus?.emit?.('task.completed', { taskId: id, durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      this.eventBus?.emit?.('task.failed', { taskId: id, error, durationMs: Date.now() - startedAt });
      throw error;
    }
  }
  start(id, intervalMs, context = {}) {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new TypeError('intervalMs must be positive');
    this.stop(id);
    const timer = setInterval(() => this.run(id, context).catch(error => logger.error(`Orchestrator task ${id}: ${error.message}`)), intervalMs);
    this._timers.set(id, timer);
    return timer;
  }
  stop(id) { const timer = this._timers.get(id); if (timer) clearInterval(timer); this._timers.delete(id); }
  startAll() { for (const [id, task] of this.tasks) if (task.intervalMs) this.start(id, task.intervalMs, task.context); }
  stopAll() { for (const id of this._timers.keys()) this.stop(id); }
  destroy() { this.stopAll(); this.tasks.clear(); }
}
