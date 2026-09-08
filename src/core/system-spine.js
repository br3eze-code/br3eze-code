import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { getTaskRegistry } from './taskRegistry.js';

/**
 * Canonical AgentOS system spine.
 *
 * All product surfaces should converge on four durable concepts:
 * resource -> work -> event -> evidence.
 * Existing engines remain compatible; this module is the small integration
 * boundary that prevents new features from becoming another orphan subsystem.
 */
export class SystemSpine extends EventEmitter {
  constructor({ tasks = getTaskRegistry() } = {}) {
    super();
    this.tasks = tasks;
    this.events = [];
    this.evidence = new Map();
    this.maxEvents = 5000;
  }

  createWork({ type = 'work', title, tenantId = null, siteId = null, actorId = null, channel = null, input = {} } = {}) {
    if (!title) throw new TypeError('title is required');
    const task = this.tasks.create(title, {
      action: type,
      owner: actorId ? { userId: actorId } : null,
      context: { tenantId, siteId, userId: actorId, channel },
      input,
    });
    this.emitEvent('work.created', { workId: task.taskId, type, title, tenantId, siteId, actorId, channel });
    return task;
  }

  updateWork(workId, patch = {}) {
    const task = this.tasks.update(workId, patch);
    if (!task) throw new Error(`Work '${workId}' not found`);
    this.emitEvent('work.updated', { workId, patch });
    return task;
  }

  emitEvent(type, data = {}, { actorId = null, tenantId = null, siteId = null } = {}) {
    const event = {
      id: randomUUID(), type, actorId, tenantId, siteId,
      data, timestamp: new Date().toISOString(),
    };
    this.events.push(event);
    if (this.events.length > this.maxEvents) this.events.shift();
    this.emit(type, event);
    this.emit('event', event);
    return event;
  }

  recordEvidence({ workId, type = 'note', uri = null, content = null, actorId = null, metadata = {} } = {}) {
    if (!workId) throw new TypeError('workId is required');
    if (!this.tasks.get(workId)) throw new Error(`Work '${workId}' not found`);
    const evidence = {
      id: randomUUID(), workId, type, uri, content, actorId, metadata,
      createdAt: new Date().toISOString(),
    };
    const list = this.evidence.get(workId) || [];
    list.push(evidence);
    this.evidence.set(workId, list);
    this.emitEvent('evidence.recorded', evidence, { actorId });
    return evidence;
  }

  getWork(workId) { return this.tasks.get(workId); }
  listWork(status = null, scope = {}) { return this.tasks.list(status, scope); }
  listEvidence(workId) { return [...(this.evidence.get(workId) || [])]; }

  health() {
    return {
      ok: true,
      work: this.tasks.summary(),
      events: this.events.length,
      evidence: [...this.evidence.values()].reduce((n, items) => n + items.length, 0),
    };
  }
}

let instance;
export function getSystemSpine() {
  if (!instance) instance = new SystemSpine();
  return instance;
}

export const SYSTEM_CONTRACT = Object.freeze({
  identity: ['tenantId', 'siteId', 'actorId', 'channel'],
  lifecycle: ['work.created', 'work.updated', 'action.executed', 'observation.recorded', 'evidence.recorded', 'outcome.completed'],
  rule: 'Apps and adapters may depend on the spine; the spine must not depend on a customer domain.',
});
