import EventEmitter from 'node:events';
import { randomUUID } from 'node:crypto';
import { AgentRegistry } from './agent-registry.js';
import { SessionEventStore } from './session/SessionEventStore.js';
import { assertTenantScope } from './saas-boundary.js';

/**
 * Domain-neutral control plane. Identity and session history each have one
 * injected/canonical owner; concrete domain behavior stays in adapters.
 */
class AgentKernel extends EventEmitter {
  constructor(options = {}) {
    super();
    this.domains = new Map();
    this.agentRegistry = options.agentRegistry || new AgentRegistry();
    this.sessionEventStore = options.sessionEventStore || new SessionEventStore();
    this._ready = false;
  }

  init() {
    this._ready = true;
    this.emit('kernel:ready', { domains: this.domains.size });
    return this;
  }

  registerDomain(domainId, adapter) {
    if (!domainId || !adapter) throw new TypeError('domainId and adapter are required');
    if (this.domains.has(domainId)) throw new Error(`Domain "${domainId}" already registered`);
    const entry = {
      id: domainId,
      adapter,
      capabilities: Array.isArray(adapter.capabilities) ? [...adapter.capabilities] : [],
    };
    this.domains.set(domainId, entry);
    this.emit('domain:registered', { domainId, capabilities: entry.capabilities });
    return entry;
  }

  registerAgent(definition) {
    return this.agentRegistry.register(definition);
  }

  getAgent(ref) {
    return this.agentRegistry.get(ref);
  }

  listAgents() {
    return this.agentRegistry.list();
  }

  resolveDomain(intent) {
    if (!this.domains.size) return null;
    if (intent?.domain && this.domains.has(intent.domain)) return this.domains.get(intent.domain);
    const needle = (typeof intent === 'object' ? (intent.text || intent.action || '') : String(intent)).toLowerCase();
    for (const [id, entry] of this.domains) {
      if (needle.includes(id.toLowerCase())) return entry;
    }
    for (const entry of this.domains.values()) {
      if (entry.capabilities.some((capability) => needle.includes(String(capability).toLowerCase()))) return entry;
    }
    return this.domains.values().next().value;
  }

  _assertContext(context) {
    assertTenantScope(context, context.resource || {});
    return context;
  }

  async dispatch(agentConfig, context = {}) {
    if (!this._ready) this.init();
    this._assertContext(context);
    const domain = this.resolveDomain(context.intent || context);
    if (!domain) throw new Error('No domain available for dispatch');

    const sessionId = randomUUID();
    const sessionMeta = {
      domain: domain.adapter.name || domain.id,
      tenantId: context.tenantId,
      userId: context.userId,
      agentId: agentConfig?.id || null,
    };
    await this.sessionEventStore.append(sessionId, 'session/created', sessionMeta);
    this.emit('dispatch:start', { sessionId, domain: sessionMeta.domain, tenantId: context.tenantId });

    await this.sessionEventStore.append(sessionId, 'session/running', { intent: context.intent || null });
    try {
      const result = typeof domain.adapter.execute === 'function'
        ? await domain.adapter.execute(context)
        : await domain.adapter.getSkills?.()[0]?.execute?.(context);
      await this.sessionEventStore.append(sessionId, 'session/completed', { result });
      this.emit('dispatch:done', { sessionId });
      return result;
    } catch (error) {
      await this.sessionEventStore.append(sessionId, 'session/failed', { error: error.message });
      this.emit('dispatch:error', { sessionId, error: error.message });
      throw error;
    }
  }

  async execute(toolName, params = {}, context = {}) {
    this._assertContext(context);
    const domain = context.domain ? this.resolveDomain(context) : this.domains.values().next().value;
    if (!domain) throw new Error('No domain registered — cannot execute tool');
    const skill = domain.adapter.getSkills?.().find((entry) => entry.name === toolName);
    if (!skill) throw new Error(`Tool not found: ${toolName}`);
    this.emit('command:run', { tool: toolName, tenantId: context.tenantId });
    const result = await skill.execute(params, context);
    this.emit('command:done', { tool: toolName });
    return result;
  }

  status() {
    return { ready: this._ready, domains: [...this.domains.keys()], agents: this.agentRegistry.list().length };
  }

  getTools() {
    const out = {};
    for (const entry of this.domains.values()) {
      for (const skill of (entry.adapter.getSkills?.() || [])) {
        out[skill.name] = {
          description: skill.description || '',
          parameters: skill.parameters || {},
          risk: skill.risk || 'low',
        };
      }
    }
    return out;
  }
}

export { AgentKernel };
export default AgentKernel;
