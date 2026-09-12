import EventEmitter from 'node:events';
import { randomUUID } from 'node:crypto';
import { sdk } from '../plugin-sdk/index.js';
import { logger } from './logger.js';
import { assertTenantScope } from './saas-boundary.js';

/**
 * AgentOS kernel: execution/control-plane only.
 * Domain behavior, persistence providers and infrastructure are injected.
 */
class InMemorySessionStore {
  constructor() { this.records = new Map(); }
  create(config = {}) { const now = Date.now(); const session = { id: randomUUID(), domain: config.domain || 'default', state: 'initializing', checkpoint: now, retryCount: 0, recoverable: true, createdAt: now, updatedAt: now, meta: structuredClone(config.meta || {}) }; this.records.set(session.id, session); return structuredClone(session); }
  get(id) { const value = this.records.get(id); return value ? structuredClone(value) : null; }
  save(session) { this.records.set(session.id, structuredClone(session)); return structuredClone(session); }
  transition(id, toState) { const valid = { initializing: ['running', 'failed'], running: ['paused', 'completed', 'failed'], paused: ['running', 'failed'], completed: [], failed: ['initializing'] }; const session = this.get(id); if (!session) throw new Error(`Session not found: ${id}`); if (!(valid[session.state] || []).includes(toState)) throw new Error(`Invalid transition: ${session.state} -> ${toState}`); session.state = toState; session.updatedAt = Date.now(); session.checkpoint = session.updatedAt; return this.save(session); }
}

class AgentKernel extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.domains = new Map(); this.agents = new Map();
    this._sessions = opts.sessionStore || new InMemorySessionStore();
    this._opts = opts; this._ready = false;
  }

  init() { this._ready = true; this.emit('kernel:ready', { domains: this.domains.size }); logger.info(`AgentKernel ready — ${this.domains.size} domain(s)`); return this; }

  registerDomain(domainId, adapter) {
    if (!domainId || !adapter) throw new TypeError('domainId and adapter are required');
    const entry = sdk.registerDomain(domainId, adapter); this.domains.set(domainId, entry);
    this.emit('domain:registered', { domainId, capabilities: entry.capabilities }); return entry;
  }

  resolveDomain(intent) {
    if (!this.domains.size) return null;
    if (intent?.domain && this.domains.has(intent.domain)) return this.domains.get(intent.domain);
    const needle = (typeof intent === 'object' ? (intent.text || intent.action || '') : String(intent)).toLowerCase();
    for (const [id, entry] of this.domains) if (needle.includes(id.toLowerCase())) return entry;
    for (const entry of this.domains.values()) if ((entry.capabilities || []).some((capability) => needle.includes(String(capability).toLowerCase()))) return entry;
    return this.domains.values().next().value;
  }

  _assertContext(context) { assertTenantScope(context, context.resource || {}); return context; }

  async dispatch(agentConfig, context = {}) {
    if (!this._ready) this.init(); this._assertContext(context);
    const domain = this.resolveDomain(context.intent || context); if (!domain) throw new Error('No domain available for dispatch');
    const session = this._sessions.create({ domain: domain.adapter.name || 'unknown', meta: { intent: context.intent, tenantId: context.tenantId, userId: context.userId } });
    this.emit('dispatch:start', { sessionId: session.id, domain: session.domain, tenantId: context.tenantId });
    try {
      this._sessions.transition(session.id, 'running');
      const result = typeof domain.adapter.execute === 'function' ? await domain.adapter.execute(context) : await domain.adapter.getSkills?.()[0]?.execute?.(context);
      this._sessions.transition(session.id, 'completed'); this.emit('dispatch:done', { sessionId: session.id }); return result;
    } catch (error) { try { this._sessions.transition(session.id, 'failed'); } catch (_) {} this.emit('dispatch:error', { sessionId: session.id, error: error.message }); throw error; }
  }

  async execute(toolName, params = {}, context = {}) {
    this._assertContext(context);
    const domain = context.domain ? this.resolveDomain(context) : this.domains.values().next().value;
    if (!domain) throw new Error('No domain registered — cannot execute tool');
    const skill = domain.adapter.getSkills?.().find((entry) => entry.name === toolName);
    if (!skill) throw new Error(`Tool not found: ${toolName}`);
    this.emit('command:run', { tool: toolName, tenantId: context.tenantId });
    const result = await skill.execute(params, context); this.emit('command:done', { tool: toolName }); return result;
  }

  status() { return { ready: this._ready, domains: [...this.domains.keys()], sdk: sdk.snapshot() }; }

  getTools() {
    const out = {};
    for (const entry of this.domains.values()) for (const skill of (entry.adapter.getSkills?.() || [])) out[skill.name] = { description: skill.description || '', parameters: skill.parameters || {}, risk: skill.risk || 'low' };
    return out;
  }
}

export { AgentKernel, InMemorySessionStore };
export default AgentKernel;
