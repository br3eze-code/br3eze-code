'use strict';
/**
 * src/harness/AgentHarness.js
 *
 * Domain-Agnostic Agent Harness — OpenClaw-compatible
 * =====================================================
 *
 * Provides a standardised execution environment for any domain adapter.
 * Inspired by OpenClaw's gateway/skill protocol but embedded directly in
 * the AgentOS runtime so no external gateway server is required.
 *
 * Architecture:
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │                  AgentHarness                       │
 *   │                                                     │
 *   │  ┌────────────┐   ┌──────────────┐  ┌───────────┐ │
 *   │  │ AgentKernel│   │ToolRegistry  │  │ChannelMgr │ │
 *   │  │ (dispatch) │   │(manifest/run)│  │(transport)│ │
 *   │  └─────┬──────┘   └──────┬───────┘  └─────┬─────┘ │
 *   │        │                 │                 │       │
 *   │  ┌─────▼─────────────────▼─────────────────▼─────┐ │
 *   │  │            DomainAdapter (pluggable)          │ │
 *   │  │   name, getSkills(), execute(), getTools()    │ │
 *   │  └───────────────────────────────────────────────┘ │
 *   └─────────────────────────────────────────────────────┘
 *
 * Usage:
 *
 *   const { AgentHarness } = require('./src/harness/AgentHarness');
 *
 *   const harness = new AgentHarness({ id: 'my-agent', llm: 'gemini' });
 *   harness.useDomain(require('./domains/network'));
 *   harness.useDomain(require('./domains/developer'));
 *   await harness.start();
 *
 *   // Execute a tool
 *   const result = await harness.run('network.ping', { host: '1.1.1.1' });
 */

const EventEmitter = require('events');
const path         = require('path');

let _logger;
function log(level, ...args) {
  try {
    _logger = _logger || require('../core/logger').logger;
    _logger[level](...args);
  } catch (_) {
    console[level === 'debug' ? 'debug' : level === 'warn' ? 'warn' : 'log'](...args);
  }
}

// ── DomainAdapter validation ────────────────────────────────────────────────
function validateAdapter(adapter) {
  if (typeof adapter !== 'object' || adapter === null) {
    throw new TypeError('DomainAdapter must be an object');
  }
  if (typeof adapter.name !== 'string' || !adapter.name) {
    throw new TypeError('DomainAdapter.name must be a non-empty string');
  }
  // execute() OR getSkills() is required
  if (typeof adapter.execute !== 'function' && typeof adapter.getSkills !== 'function') {
    throw new TypeError(`DomainAdapter "${adapter.name}" must implement execute() or getSkills()`);
  }
  // getCapabilities() is required by plugin-sdk.registerDomain()
  if (typeof adapter.getCapabilities !== 'function') {
    throw new TypeError(`DomainAdapter "${adapter.name}" must implement getCapabilities()`);
  }
  return true;
}

// ── AgentHarness ────────────────────────────────────────────────────────────
class AgentHarness extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} [opts.id]           Agent ID (default: 'agentos')
   * @param {string} [opts.name]         Human-readable name
   * @param {string} [opts.llm]          LLM provider hint (gemini|openai|anthropic|local)
   * @param {string} [opts.dbPath]       SQLite state path
   * @param {object} [opts.channels]     Channel configs to auto-register
   * @param {boolean}[opts.exposeOClaw]  Expose OpenClaw manifest endpoint (default true)
   */
  constructor(opts = {}) {
    super();

    this.id      = opts.id   || process.env.AGENTOS_AGENT_ID   || 'agentos';
    this.name    = opts.name || process.env.AGENTOS_AGENT_NAME  || 'AgentOS';
    this.version = (() => { try { return require('../../package.json').version; } catch { return '1.0.0'; } })();
    this._opts   = opts;

    this._domains  = new Map();   // domainId → adapter
    this._hooks    = { before: [], after: [], error: [] };
    this._started  = false;
    this._kernel   = null;        // lazy AgentKernel
    this._registry = null;        // lazy ToolRegistry
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  /**
   * Register a domain adapter.
   * @param {object} adapter  { name, execute?, getSkills?, getTools?, capabilities? }
   * @returns {this}  chainable
   */
  useDomain(adapter) {
    validateAdapter(adapter);
    this._domains.set(adapter.name, adapter);
    log('debug', `[AgentHarness] domain registered: ${adapter.name}`);
    this.emit('domain:registered', { id: adapter.name });
    return this;
  }

  /**
   * Register a middleware hook.
   * @param {'before'|'after'|'error'} event
   * @param {Function}                 fn
   */
  useHook(event, fn) {
    if (!this._hooks[event]) throw new TypeError(`Unknown hook event: ${event}`);
    this._hooks[event].push(fn);
    return this;
  }

  /**
   * Start the harness: initialise AgentKernel and forward domains.
   * @returns {Promise<this>}
   */
  async start() {
    if (this._started) return this;

    // Lazy-load AgentKernel & ToolRegistry to avoid circular deps at require time
    const AgentKernel   = require('../core/agentKernel');
    const { ToolRegistry } = require('../core/ToolRegistry');

    this._kernel   = new AgentKernel({ dbPath: this._opts.dbPath });
    this._registry = new ToolRegistry();

    // Register all domains on the kernel
    for (const [id, adapter] of this._domains) {
      this._kernel.registerDomain(id, adapter);

      // Also register individual tool functions on the flat ToolRegistry
      const tools = typeof adapter.getTools === 'function' ? adapter.getTools() : {};
      const toolDefs = Object.entries(tools).map(([tName, spec]) => ({
        name:        tName,
        description: spec.description || '',
        parameters:  spec.parameters  || {},
        risk:        spec.risk        || 'low',
        execute:     spec.execute     || (async (ctx, ...p) => adapter.execute({ tool: tName, params: p, ...ctx })),
      }));
      if (toolDefs.length) {
        this._registry.registerDomain(id, toolDefs);
      }
    }

    this._kernel.init(this._opts.dbPath);
    this._started = true;

    log('info', `[AgentHarness] started — id: ${this.id}, domains: ${[...this._domains.keys()].join(', ')}`);
    this.emit('harness:started', {
      id:      this.id,
      domains: [...this._domains.keys()],
    });
    return this;
  }

  /**
   * Stop the harness gracefully.
   */
  async stop() {
    this._started = false;
    this.emit('harness:stopped', { id: this.id });
    log('info', `[AgentHarness] stopped — ${this.id}`);
  }

  // ── Execution ──────────────────────────────────────────────────────────────
  /**
   * Run a tool by full name (e.g. 'network.ping').
   *
   * @param {string}  toolName   'domain.tool'
   * @param {object}  params     Tool parameters
   * @param {object}  [context]  Execution context { userId, workspace, … }
   * @returns {Promise<any>}
   */
  async run(toolName, params = {}, context = {}) {
    if (!this._started) await this.start();

    const ctx = { ...context, harness: this, agentId: this.id };

    // Before hooks
    for (const hook of this._hooks.before) {
      await hook(toolName, params, ctx);
    }

    let result;
    try {
      // Try ToolRegistry first (flat map)
      const tool = this._registry?.getTool(toolName);
      if (tool) {
        result = await tool.execute(ctx, params);
      } else {
        // Fallback: dispatch via AgentKernel
        result = await this._kernel.dispatch({ name: toolName }, {
          intent: { domain: toolName.split('.')[0], action: toolName, text: toolName },
          params,
          ...ctx,
        });
      }
    } catch (err) {
      for (const hook of this._hooks.error) await hook(toolName, err, ctx);
      throw err;
    }

    // After hooks
    for (const hook of this._hooks.after) {
      await hook(toolName, result, ctx);
    }

    return result;
  }

  /**
   * Process a raw channel message (text → intent → tool dispatch).
   * @param {string}  text     User message text
   * @param {object}  context  { userId, channel, … }
   */
  async processMessage(text, context = {}) {
    if (!this._started) await this.start();

    return this._kernel.dispatch({}, {
      intent: { text },
      ...context,
    });
  }

  // ── Introspection ──────────────────────────────────────────────────────────
  /**
   * Returns the OpenClaw-compatible capability manifest for this agent.
   */
  getManifest() {
    const tools = this._registry ? this._registry.getManifest() : { tools: [] };
    return {
      id:          this.id,
      name:        this.name,
      version:     this.version,
      description: `Domain-agnostic AgentOS instance (${[...this._domains.keys()].join(', ')})`,
      domains:     [...this._domains.keys()],
      ...tools,
    };
  }

  /**
   * Returns harness health/status object.
   */
  status() {
    return {
      id:      this.id,
      started: this._started,
      domains: [...this._domains.keys()],
      kernel:  this._kernel?.status() || null,
    };
  }

  // ── Static factory helpers ─────────────────────────────────────────────────
  /**
   * Create a minimal harness with no pre-loaded domains.
   * Good for tests and embedding.
   */
  static create(opts = {}) {
    return new AgentHarness(opts);
  }

  /**
   * Create a harness and auto-discover domains from a directory.
   * Each file in the dir should export an adapter object { name, execute? }.
   */
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

module.exports = { AgentHarness };
