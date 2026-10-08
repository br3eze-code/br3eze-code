import EventEmitter from 'events';
import crypto from 'node:crypto';
import { SessionEventStore } from './session/SessionEventStore.js';
import { logger } from './logger.js';

const log = (level, ...args) => logger[level]?.(...args);

// ── AgentKernel ──────────────────────────────────────────────────────────────
class AgentKernel extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.domains  = new Map();
    this.agents   = new Map();
    this.sessionEventStore = opts.sessionEventStore || new SessionEventStore();
    this._opts    = opts;
    this._ready   = false;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  init(_dbPath) {
    // Storage ownership belongs to SessionEventStore. dbPath is retained only
    // for backwards-compatible callers; durable adapters are injected.
    this._ready = true;
    this.emit('kernel:ready', { domains: this.domains.size });
    log('info', `[AgentKernel] ready — ${this.domains.size} domain(s)`);
    return this;
  }

  // ── Domain registration ────────────────────────────────────────────────────
  registerDomain(domainId, adapter) {
    if (!domainId || typeof domainId !== 'string') throw new TypeError('domainId is required');
    if (!adapter || typeof adapter !== 'object') throw new TypeError('adapter is required');
    const capabilities = typeof adapter.getCapabilities === 'function'
      ? adapter.getCapabilities()
      : Array.isArray(adapter.capabilities) ? adapter.capabilities : [];
    const entry = { id: domainId, domainId, adapter, capabilities: [...capabilities] };
    this.domains.set(domainId, entry);
    this.emit('domain:registered', { domainId, capabilities: entry.capabilities });
    log('debug', `[AgentKernel] domain registered: ${domainId}`);
    return entry;
  }

  // ── Domain resolution ──────────────────────────────────────────────────────
  resolveDomain(intent) {
    if (!intent || !this.domains.size) return this.domains.size ? [...this.domains.values()][0] : null;

    // Caller passed explicit { domain: 'network' }
    if (typeof intent === 'object' && intent.domain) {
      const d = this.domains.get(intent.domain);
      if (d) return d;
    }

    const needle = (typeof intent === 'object' ? (intent.text || intent.action || '') : String(intent)).toLowerCase();

    // Domain id match
    for (const [id, entry] of this.domains)
      if (needle.includes(id)) return entry;

    // Capability keyword match
    for (const [, entry] of this.domains)
      if ((entry.capabilities || []).some((c) => needle.includes(c.toLowerCase()))) return entry;

    // First registered
    return [...this.domains.values()][0];
  }

  // ── Dispatch ───────────────────────────────────────────────────────────────
  async dispatch(agentConfig, context = {}) {
    if (!this._ready) this.init();
    const domain = this.resolveDomain(context.intent || context);
    if (!domain) throw new Error('No domain available for dispatch');

    const sessionId = crypto.randomUUID();
    const domainName = domain.adapter.name || 'unknown';
    await this.sessionEventStore.append(sessionId, 'session/created', {
      domain: domainName,
      intent: context.intent,
      agentConfig,
    }, { source: 'agent.kernel' });

    this.emit('dispatch:start', { sessionId, domain: domainName });
    try {
      await this.sessionEventStore.append(sessionId, 'session/running', { domain: domainName }, { source: 'agent.kernel' });
      const result = typeof domain.adapter.execute === 'function'
        ? await domain.adapter.execute(context)
        : await domain.adapter.getSkills?.()[0]?.execute?.(context);
      await this.sessionEventStore.append(sessionId, 'session/completed', { domain: domainName }, { source: 'agent.kernel' });
      this.emit('dispatch:done', { sessionId });
      return result;
    } catch (err) {
      try { await this.sessionEventStore.append(sessionId, 'session/failed', { domain: domainName, error: err.message }, { source: 'agent.kernel' }); } catch (_) {}
      this.emit('dispatch:error', { sessionId, error: err.message });
      throw err;
    }
  }

  // ── Tool execution (backward compat with src/kernel.js callers) ───────────
  async execute(toolName, params = {}) {
    const domain = [...this.domains.values()][0];
    if (!domain) throw new Error('No domain registered — cannot execute tool');
    const skill = domain.adapter.getSkills?.().find((s) => s.name === toolName);
    if (!skill) throw new Error(`Tool not found: ${toolName}`);
    this.emit('command:run', { tool: toolName, params });
    const result = await skill.execute(params);
    this.emit('command:done', { tool: toolName, result });
    return result;
  }

  // ── Introspection ──────────────────────────────────────────────────────────
  status() {
    return {
      ready: this._ready,
      domains: [...this.domains.keys()],
      capabilities: [...this.domains.values()].flatMap((entry) => entry.capabilities || []),
    };
  }

  // ── getTools — for openclaw meta.js ───────────────────────────────────────
  getTools() {
    const out = {};
    for (const [, entry] of this.domains) {
      for (const skill of (entry.adapter.getSkills?.() || [])) {
        out[skill.name] = {
          description: skill.description || '',
          parameters:  skill.parameters  || {},
          risk:        skill.risk        || 'low',
        };
      }
    }
    return out;
  }
}


/**
 * Runtime contract boundary.
 * A runtime implementation prepares and executes one agent turn; the kernel
 * exposes the stable request/validation contract without owning runtime state.
 */
export const AGENT_RUNTIME_CONTRACT_VERSION = '1.0';

export function createRuntimeRequest({ sessionId, input, context = {}, capabilities = [], checkpoint = null } = {}) {
  if (!sessionId) throw new TypeError('sessionId is required');
  if (input === undefined || input === null) throw new TypeError('input is required');
  return Object.freeze({
    contractVersion: AGENT_RUNTIME_CONTRACT_VERSION,
    sessionId,
    input,
    context: Object.freeze({ ...context }),
    capabilities: Object.freeze([...capabilities]),
    checkpoint,
  });
}

export function validateRuntime(runtime) {
  if (!runtime || typeof runtime !== 'object') throw new TypeError('runtime must be an object');
  if (typeof runtime.executeTurn !== 'function') throw new TypeError('runtime must implement executeTurn(request)');
  return runtime;
}

export default AgentKernel;
