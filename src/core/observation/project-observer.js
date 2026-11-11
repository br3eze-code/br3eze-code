import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

const RUNTIME_EVENTS = ['session:created', 'turn', 'task:dispatched', 'os.lifecycle', 'os.ipc.audit'];
const DEFAULT_HISTORY_LIMIT = 200;

function safeId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized && normalized.length <= 128 ? normalized : null;
}

function safeTimestamp(value) {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return new Date().toISOString();
}

function normalizeRuntimeEvent(type, payload, options = {}) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const task = type === 'task:dispatched' ? data : {};
  const session = type === 'session:created' ? data : {};
  const turn = type === 'turn' ? data : {};
  const failed = type === 'turn' && turn.stopReason && turn.stopReason !== 'completed';
  const activity = task.wbs || data.wbs || {};
  const activityId = safeId(activity.activityId || activity.id || task.activityId || data.activityId);
  const taskId = safeId(task.taskId || data.taskId || session.taskId);
  const sessionId = safeId(session.sessionId || data.sessionId);
  const summaryByType = {
    'session:created': 'Agent session created',
    turn: failed ? 'Agent turn stopped before normal completion' : 'Agent turn completed',
    'task:dispatched': 'Agent task dispatched',
    'os.lifecycle': 'Operating-system lifecycle event observed',
    'os.ipc.audit': 'IPC audit event observed',
  };
  return Object.freeze({
    eventId: randomUUID(),
    timestamp: safeTimestamp(data.timestamp || data.createdAt || turn.timestamp),
    source: 'agent-runtime',
    projectId: safeId(options.projectId),
    activityId,
    owner: safeId(activity.owner || task.owner || options.owner) || 'agent-runtime',
    severity: failed ? 'warning' : 'info',
    status: failed ? 'attention-required' : type,
    summary: summaryByType[type] || 'Agent runtime event observed',
    evidenceRef: taskId || sessionId || null,
    redactionApplied: true,
  });
}

/**
 * Read-only observer adapter for the canonical AgentRuntime EventEmitter.
 * It deliberately stores normalized metadata only, never prompts, model output,
 * credentials, arbitrary IPC payloads, or raw lifecycle data.
 */
export class ProjectObserver extends EventEmitter {
  constructor({ runtime, projectId = null, owner = 'agent-runtime', historyLimit = DEFAULT_HISTORY_LIMIT } = {}) {
    super();
    if (!runtime || typeof runtime.on !== 'function' || typeof runtime.removeListener !== 'function') {
      throw new TypeError('ProjectObserver requires an EventEmitter-compatible AgentRuntime');
    }
    this.runtime = runtime;
    this.projectId = safeId(projectId);
    this.owner = safeId(owner) || 'agent-runtime';
    this.historyLimit = Number.isInteger(historyLimit) && historyLimit > 0
      ? Math.min(historyLimit, 2000)
      : DEFAULT_HISTORY_LIMIT;
    this.history = [];
    this.started = false;
    this.handlers = new Map();
    this.lastEventAt = null;
  }

  start() {
    if (this.started) return this;
    for (const type of RUNTIME_EVENTS) {
      const handler = (payload) => {
        const event = normalizeRuntimeEvent(type, payload, { projectId: this.projectId, owner: this.owner });
        this.history.push(event);
        if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit);
        this.lastEventAt = event.timestamp;
        this.emit('event', event);
      };
      this.handlers.set(type, handler);
      this.runtime.on(type, handler);
    }
    this.started = true;
    this.emit('status', this.getStatus());
    return this;
  }

  stop() {
    if (!this.started) return this;
    for (const [type, handler] of this.handlers) this.runtime.removeListener(type, handler);
    this.handlers.clear();
    this.started = false;
    this.emit('status', this.getStatus());
    return this;
  }

  getEvents({ since = null, limit = 50 } = {}) {
    const boundedLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, this.historyLimit)) : 50;
    const sinceTime = since && !Number.isNaN(Date.parse(since)) ? Date.parse(since) : null;
    return this.history
      .filter((event) => sinceTime === null || Date.parse(event.timestamp) > sinceTime)
      .slice(-boundedLimit);
  }

  getStatus() {
    return Object.freeze({
      connected: this.started,
      source: 'agent-runtime',
      projectId: this.projectId,
      eventCount: this.history.length,
      lastEventAt: this.lastEventAt,
      mode: 'read-only',
      rawPayloadsStored: false,
    });
  }
}

export default ProjectObserver;
