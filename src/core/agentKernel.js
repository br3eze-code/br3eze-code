import EventEmitter from 'events';
import sdk from '../plugin-sdk/index.js';
import { createRequire } from 'module';
import { requireSessionStore } from './ports/session-store.js';

const require = createRequire(import.meta.url);

/**
 * AgentKernel — domain-agnostic kernel primitives.
 *
 * Persistence is supplied through the SessionStore port by the host.
 * The kernel does not instantiate SQLite, Firebase, or any other database.
 */
let _logger;
function log(level, ...a) {
  try { _logger = _logger || require('./logger').logger; _logger[level](...a); }
  catch (_) { console[level === 'debug' ? 'debug' : level === 'warn' ? 'warn' : 'log'](...a); }
}

class AgentKernel extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.domains = new Map();
    this.agents = new Map();
    this._sessions = opts.sessionStore || null;
    this._opts = opts;
    this._ready = false;
  }

  init() {
    if (!this._sessions) this._sessions = requireSessionStore();
    this._sessions.initialize?.();
    this._ready = true;
    this.emit('kernel:ready', { domains: this.domains.size });
    log('info', `[AgentKernel] ready — ${this.domains.size} domain(s)`);
    return this;
  }

  registerDomain(domainId, adapter) {
    const entry = sdk.registerDomain(domainId, adapter);
    this.domains.set(domainId, entry);
    this.emit('domain:registered', { domainId, capabilities: entry.capabilities });
    log('debug', `[AgentKernel] domain registered: ${domainId}`);
    return entry;
  }

  /** Resolve only when intent is explicit or uniquely matches a domain. */
  resolveDomain(intent) {
    if (!this.domains.size) return null;
    if (typeof intent === 'object' && intent?.domain) return this.domains.get(intent.domain) || null;

    const needle = (typeof intent === 'object'
      ? (intent.text || intent.action || '')
      : String(intent || '')).trim().toLowerCase();
    if (!needle) return this.domains.size === 1 ? [...this.domains.values()][0] : null;

    const idMatches = [...this.domains.entries()]
      .filter(([id]) => needle.includes(id.toLowerCase()))
      .map(([, entry]) => entry);
    if (idMatches.length === 1) return idMatches[0];
    if (idMatches.length > 1) return null;

    const capabilityMatches = [];
    for (const entry of this.domains.values()) {
      if ((entry.capabilities || []).some((c) => needle.includes(String(c).toLowerCase()))) capabilityMatches.push(entry);
    }
    return capabilityMatches.length === 1 ? capabilityMatches[0] : null;
  }

  async dispatch(agentConfig, context = {}) {
    if (!this._ready) this.init();
    const domain = this.resolveDomain(context.intent || context);
    if (!domain) {
      const error = new Error('Unable to resolve a unique domain for dispatch');
      error.code = 'DOMAIN_RESOLUTION_AMBIGUOUS';
      error.intent = context.intent || context;
      throw error;
    }

    const session = this._sessions.create({
      domain: domain.adapter.name || 'unknown',
      meta: { intent: context.intent },
    });
    this.emit('dispatch:start', { sessionId: session.id, domain: session.domain });
    try {
      this._sessions.transition(session.id, 'running');
      const result = typeof domain.adapter.execute === 'function'
        ? await domain.adapter.execute(context)
        : await domain.adapter.getSkills?.()[0]?.execute?.(context);
      this._sessions.transition(session.id, 'completed');
      this.emit('dispatch:done', { sessionId: session.id });
      return result;
    } catch (err) {
      try { this._sessions.transition(session.id, 'failed'); } catch (_) {}
      this.emit('dispatch:error', { sessionId: session.id, error: err.message });
      throw err;
    }
  }

  async execute(toolName, params = {}) {
    const name = String(toolName);
    const domainId = name.split('.')[0];
    const domain = this.domains.get(domainId) || this.resolveDomain({ action: name, text: name });
    if (!domain) throw new Error(`No unique domain for tool: ${name}`);
    const skillName = name.includes('.') ? name.split('.').slice(1).join('.') : name;
    const skill = domain.adapter.getSkills?.().find((s) => s.name === skillName || s.name === name);
    if (!skill) throw new Error(`Tool not found: ${name}`);
    this.emit('command:run', { tool: name, params });
    const result = await skill.execute(params);
    this.emit('command:done', { tool: name, result });
    return result;
  }

  status() { return { ready: this._ready, domains: [...this.domains.keys()], sdk: sdk.snapshot() }; }

  getTools() {
    const out = {};
    for (const [, entry] of this.domains) {
      for (const skill of (entry.adapter.getSkills?.() || [])) {
        out[skill.name] = { description: skill.description || '', parameters: skill.parameters || {}, risk: skill.risk || 'low' };
      }
    }
    return out;
  }
}

export default AgentKernel;
