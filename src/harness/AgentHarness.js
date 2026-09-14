import path from 'path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'module';
import { SqliteSessionStore } from '../adapters/persistence/sqlite-session-store.js';
import { MemorySessionStore } from '../adapters/persistence/memory-session-store.js';

const require = createRequire(import.meta.url);

/**
 * Domain-agnostic Agent Harness — host/composition facade.
 *
 * The harness owns host concerns: adapter registration, ToolRegistry wiring,
 * channels/hooks, and persistence selection. Execution semantics remain in
 * AgentKernel/AgentRuntime.
 */
let _logger;
function log(level, ...args) {
  try { _logger = _logger || require('../core/logger').logger; _logger[level](...args); }
  catch (_) { console[level === 'debug' ? 'debug' : level === 'warn' ? 'warn' : 'log'](...args); }
}

function validateAdapter(adapter) {
  if (typeof adapter !== 'object' || adapter === null) throw new TypeError('DomainAdapter must be an object');
  if (typeof adapter.name !== 'string' || !adapter.name) throw new TypeError('DomainAdapter.name must be a non-empty string');
  if (typeof adapter.execute !== 'function' && typeof adapter.getSkills !== 'function') {
    throw new TypeError(`DomainAdapter "${adapter.name}" must implement execute() or getSkills()`);
  }
  if (typeof adapter.getCapabilities !== 'function') {
    throw new TypeError(`DomainAdapter "${adapter.name}" must implement getCapabilities()`);
  }
  return true;
}

class AgentHarness extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.id = opts.id || process.env.AGENTOS_AGENT_ID || 'agentos';
    this.name = opts.name || process.env.AGENTOS_AGENT_NAME || 'AgentOS';
    this.version = (() => { try { return require('../../package.json').version; } catch { return '1.0.0'; } })();
    this._opts = opts;
    this._domains = new Map();
    this._hooks = { before: [], after: [], error: [] };
    this._started = false;
    this._kernel = null;
    this._registry = null;
    this._sessionStore = opts.sessionStore || null;
  }

  useDomain(adapter) {
    validateAdapter(adapter);
    this._domains.set(adapter.name, adapter);
    log('debug', `[AgentHarness] domain registered: ${adapter.name}`);
    this.emit('domain:registered', { id: adapter.name });
    return this;
  }

  useHook(event, fn) {
    if (!this._hooks[event]) throw new TypeError(`Unknown hook event: ${event}`);
    if (typeof fn !== 'function') throw new TypeError('Hook must be a function');
    this._hooks[event].push(fn);
    return this;
  }

  async start() {
    if (this._started) return this;

    const AgentKernel = (await import('../core/agentKernel.js')).default;
    const { ToolRegistry } = await import('../core/ToolRegistry.js');

    if (!this._sessionStore) {
      this._sessionStore = this._opts.dbPath
        ? new SqliteSessionStore({ dbPath: this._opts.dbPath })
        : new MemorySessionStore();
    }
    this._sessionStore.initialize?.();
    this._kernel = new AgentKernel({ sessionStore: this._sessionStore });
    this._registry = new ToolRegistry();

    for (const [id, adapter] of this._domains) {
      this._kernel.registerDomain(id, adapter);
      const tools = typeof adapter.getTools === 'function' ? adapter.getTools() : {};
      const toolDefs = Object.entries(tools).map(([tName, spec]) => ({
        name: tName,
        description: spec.description || '',
        parameters: spec.parameters || {},
        risk: spec.risk || 'low',
        execute: spec.execute || (async (ctx, ...p) => adapter.execute({ tool: tName, params: p, ...ctx })),
      }));
      if (toolDefs.length) this._registry.registerDomain(id, toolDefs);
    }

    this._kernel.init();
    this._started = true;
    log('info', `[AgentHarness] started — id: ${this.id}, domains: ${[...this._domains.keys()].join(', ')}`);
    this.emit('harness:started', { id: this.id, domains: [...this._domains.keys()] });
    return this;
  }

  async stop() {
    this._started = false;
    this.emit('harness:stopped', { id: this.id });
    log('info', `[AgentHarness] stopped — ${this.id}`);
  }

  async run(toolName, params = {}, context = {}) {
    if (!this._started) await this.start();
    const ctx = { ...context, harness: this, agentId: this.id };
    for (const hook of this._hooks.before) await hook(toolName, params, ctx);
    try {
      const tool = this._registry?.getTool(toolName);
      const result = tool
        ? await tool.execute(ctx, params)
        : await this._kernel.execute(toolName, params);
      for (const hook of this._hooks.after) await hook(toolName, result, ctx);
      return result;
    } catch (err) {
      for (const hook of this._hooks.error) await hook(toolName, err, ctx);
      throw err;
    }
  }

  async processMessage(text, context = {}) {
    if (!this._started) await this.start();
    return this._kernel.dispatch({}, { intent: { text }, ...context });
  }

  getManifest() {
    const tools = this._registry ? this._registry.getManifest() : { tools: [] };
    return {
      id: this.id, name: this.name, version: this.version,
      description: `Domain-agnostic AgentOS instance (${[...this._domains.keys()].join(', ')})`,
      domains: [...this._domains.keys()], ...tools,
    };
  }

  status() {
    return { id: this.id, started: this._started, domains: [...this._domains.keys()], kernel: this._kernel?.status() || null };
  }

  static create(opts = {}) { return new AgentHarness(opts); }

  static async fromDirectory(domainsDir, opts = {}) {
    const fs = require('fs');
    const harness = new AgentHarness(opts);
    const files = fs.readdirSync(domainsDir).filter((f) => f.endsWith('.js'));
    for (const file of files) {
      try {
        const adapter = require(path.join(domainsDir, file));
        const a = adapter.default || adapter;
        if (a && a.name) harness.useDomain(a);
      } catch (err) {
        log('warn', `[AgentHarness] could not load domain ${file}: ${err.message}`);
      }
    }
    return harness;
  }
}

export { AgentHarness };
