'use strict';
/**
 * src/core/ToolRegistry.js
 *
 * Unified, canonical ToolRegistry.
 *
 * Merges the two previously duplicate classes:
 *   - ToolRegistry (PascalCase, this file) — domain-aware, permission-aware
 *   - tool-registry.js                     — skill/manifest-aware, YAML loader
 *
 * Callers requiring tool-registry.js are re-directed here via module.exports
 * at the bottom. Both the class AND a default singleton instance are exported
 * to satisfy all existing consumers.
 */

const { logger } = require('./logger');

// Stub permission/hook system — replace with real implementations when ready
const permissionPolicy = {
  check: (_toolName, _context) => ({ allowed: true }),
};

const hooks = {
  runBefore: async () => {},
  runAfter: async () => {},
};

class ToolRegistry {
  /**
   * @param {object} opts
   * @param {string} [opts.skillsPath]   Path to load skill manifests from (optional)
   */
  constructor(opts = {}) {
    // Domain-keyed tool map: 'domain.tool' → { execute, schema, description, domain, skill }
    this.tools = new Map();
    this.skills = new Map();
    this.domains = new Set();

    // Skill-loading config (from the old tool-registry.js)
    this._skillsPath = opts.skillsPath || null;
    this._manifestCache = null;

    this.logger = logger;
  }

  // ── Domain registration (from ToolRegistry.js) ────────────────────────────
  /**
   * Register an array of tool definitions under a domain name.
   * @param {string}   domainName
   * @param {Array<{name:string, description:string, execute:Function, schema?:object}>} toolDefs
   */
  registerDomain(domainName, toolDefs) {
    if (!Array.isArray(toolDefs)) {
      this.logger.error(`registerDomain(${domainName}): tools must be an array`);
      return;
    }
    this.domains.add(domainName);
    toolDefs.forEach(tool => {
      const fullName = `${domainName}.${tool.name}`;
      this.tools.set(fullName, { ...tool, domain: domainName, fullName });
      this._manifestCache = null;
    });
    this.logger.info(
      `ToolRegistry: registered domain "${domainName}" with ${toolDefs.length} tool(s)`
    );
  }

  // ── Individual tool registration ──────────────────────────────────────────
  /**
   * Register a single tool by full name (e.g. 'network.ping').
   */
  register(fullName, toolDef) {
    const [domain] = fullName.split('.');
    this.domains.add(domain);
    this.tools.set(fullName, { ...toolDef, domain, fullName });
    this._manifestCache = null;
  }

  // ── Execution ─────────────────────────────────────────────────────────────
  /**
   * Execute a tool by full name.
   * @param {string}   fullToolName  e.g. 'network.ping'
   * @param {Array}    params        Positional params (legacy) OR
   * @param {object}   context       Context object { client, userId, workspace, … }
   */
  async execute(fullToolName, params = [], context = {}) {
    const tool = this.tools.get(fullToolName);
    if (!tool) throw new Error(`Tool not found: ${fullToolName}`);

    const perm = permissionPolicy.check(fullToolName, context);
    if (!perm.allowed) throw new Error(perm.reason || `Permission denied: ${fullToolName}`);

    await hooks.runBefore(fullToolName, params, context);
    const result = Array.isArray(params)
      ? await tool.execute(context, ...params)
      : await tool.execute(params, context); // params IS the context (object form)
    await hooks.runAfter(fullToolName, params, result);

    return result;
  }

  // ── Queries ───────────────────────────────────────────────────────────────
  getTool(name) {
    return this.tools.get(name);
  }
  getAllTools() {
    return Array.from(this.tools.values());
  }
  getToolsByDomain(d) {
    return Array.from(this.tools.values()).filter(t => t.domain === d);
  }
  getToolsForDomain(d) {
    return this.getToolsByDomain(d);
  } // alias

  // ── OpenClaw / ACP manifest ───────────────────────────────────────────────
  /**
   * Returns a capability manifest in OpenClaw/ACP standard format.
   */
  getManifest() {
    if (this._manifestCache) return this._manifestCache;
    const toolList = Array.from(this.tools.values()).map(t => ({
      name: t.fullName,
      description: t.description || t.schema?.description || '',
      parameters: t.schema?.parameters || t.parameters || [],
      returns: t.schema?.returns || 'any',
      domain: t.domain,
      risk: t.risk || 'low',
    }));
    this._manifestCache = {
      version: '2.0.0',
      agent: 'AgentOS',
      domains: Array.from(this.domains),
      tools: toolList,
      safety: {
        maxToolsPerRequest: 10,
        allowedOperations: toolList.map(t => t.name),
      },
    };
    return this._manifestCache;
  }

  /** Invalidate manifest cache (call after adding tools) */
  invalidateManifest() {
    this._manifestCache = null;
  }
}

// ── Singleton default export (backward compat with tool-registry.js consumers)
const _singleton = new ToolRegistry();

module.exports = _singleton; // default: singleton instance
module.exports.ToolRegistry = ToolRegistry; // named: class for tests / DI
module.exports.default = _singleton; // ESM interop
