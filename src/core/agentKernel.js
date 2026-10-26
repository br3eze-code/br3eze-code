import EventEmitter from 'node:events';
import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';
import { assertTenantScope } from './saas-boundary.js';
import { AgentRegistry } from './agent-registry.js';
import { SessionEventStore } from './session/SessionEventStore.js';

/**
 * AgentOS kernel: execution/control-plane only. Domain and infrastructure are injected.
 * Session history and agent identity are delegated to their canonical owners.
 */
class AgentKernel extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.domains = new Map();
    this.agentRegistry = opts.agentRegistry || new AgentRegistry();
    this.sessionEventStore = opts.sessionEventStore || new SessionEventStore();
    this._opts = opts;
    this._ready = false;
  }

  init() {
    this._ready = true;
    this.emit('kernel:ready', { domains: this.domains.size });
    logger.info(`AgentKernel ready — ${this.domains.size} domain(s)`);
    return this;
  }

  registerDomain(domainId, adapter) {
    if (!domainId || !adapter) throw new TypeError('domainId and adapter are required');
    const entry = {
      domainId,
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
      if ((entry.capabilities || []).some((capability) => needle.includes(String(capability).toLowerCase()))) return entry;
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
    const session = {
      id: sessionId,
      domain: domain.adapter.name || 'unknown',
      tenantId: context.tenantId,
      userId: context.userId,
      agentId: agentConfig?.id || null,
    };
    await this.sessionEventStore.append(sessionId, 'session/created', session);
    this.emit('dispatch:start', { sessionId, domain: session.domain, tenantId: context.tenantId });

    try {
      await this.sessionEventStore.append(sessionId, 'session/running', { state: 'running' });
      const result = typeof domain.adapter.execute === 'function'
        ? await domain.adapter.execute(context)
        : await domain.adapter.getSkills?.()[0]?.execute?.(context);
      await this.sessionEventStore.append(sessionId, 'session/completed', { state: 'completed' });
      this.emit('dispatch:done', { sessionId });
      return result;
    } catch (error) {
      try {
        await this.sessionEventStore.append(sessionId, 'session/failed', {
          state: 'failed',
          error: { name: error?.name || 'Error', message: error?.message || String(error) },
        });
      } catch (recordError) {
        logger.error('Failed to persist session failure event', { sessionId, error: recordError?.message });
      }
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
    try {
      const result = await skill.execute(params, context);
      this.emit('command:done', { tool: toolName });
      return result;
    } catch (error) {
      this.emit('command:error', { tool: toolName, error: error?.message || String(error) });
      throw error;
    }
  }

  status() {
    return {
      ready: this._ready,
      domains: [...this.domains.keys()],
      agents: this.agentRegistry.list().length,
    };
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

  close() {
    return this.sessionEventStore.close();
  }
}

export { AgentKernel };
export default AgentKernel;
