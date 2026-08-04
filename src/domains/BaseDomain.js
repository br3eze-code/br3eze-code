import { logger } from '../core/logger.js';

/**
 * src/domains/BaseDomain.js
 *
 * Base class for all domain adapters.
 * Subclass this to create a new domain plugin for the AgentHarness.
 *
 * Required interface:
 *   - this.name       {string}  domain id (e.g. 'network')
 *   - getSkills()     {Array}   list of { name, description, execute, parameters?, risk? }
 *
 * Optional (but recommended for full ToolRegistry/OpenClaw compatibility):
 *   - getTools()      {object}  flat map of 'domain.tool' → spec
 *   - execute(ctx)    {any}     single entry-point called by AgentKernel.dispatch()
 *   - capabilities    {Array}   hint strings for AgentKernel.resolveDomain()
 */

class BaseDomain {
  constructor() {
    this.name         = 'base';
    this.description  = '';
    this.capabilities = [];
    this.tools        = [];
  }

  /**
   * Register a tool on this domain.
   * @param {{ name: string, description?: string, execute: Function, parameters?: object, risk?: string }} tool
   */
  registerTool(tool) {
    if (!tool.name || typeof tool.execute !== 'function') {
      logger.error(`Domain ${this.name}: invalid tool registration — name and execute() required`);
      return;
    }
    this.tools.push(tool);
  }

  /**
   * Returns all tools as an array (used by AgentKernel domain registration).
   * @returns {Array}
   */
  getSkills() {
    return this.tools;
  }

  /**
   * Returns a flat map { 'domain.toolName': spec } for the ToolRegistry.
   * @returns {object}
   */
  getTools() {
    const out = {};
    for (const tool of this.tools) {
      out[`${this.name}.${tool.name}`] = {
        description: tool.description || tool.name,
        parameters:  tool.parameters  || {},
        risk:        tool.risk        || 'low',
        execute:     (ctx, params) => {
          const args = params === undefined ? [] : (Array.isArray(params) ? params : [params]);
          return args.length >= tool.execute.length ? tool.execute(...args, ctx) : tool.execute(...args);
        },
      };
    }
    return out;
  }

  /**
   * Execute a tool by name — used by AgentKernel.dispatch() when routing to this domain.
   * @param {object} ctx  { tool, params, userId, client, … }
   */
  async execute(ctx = {}) {
    const { tool, params } = ctx;
    const skill = this.tools.find((t) => t.name === tool || t.name === `${this.name}.${tool}`);
    if (!skill) throw new Error(`Domain "${this.name}": tool not found — "${tool}"`);
    const args = params === undefined ? [] : (Array.isArray(params) ? params : [params]);
    return args.length >= skill.execute.length ? skill.execute(...args, ctx) : skill.execute(...args);
  }

  /**
   * Returns capability strings for AgentKernel.resolveDomain() and plugin-sdk.registerDomain().
   * @returns {string[]}
   */
  getCapabilities() {
    if (this.capabilities && this.capabilities.length) return this.capabilities;
    // Fall back to tool names if capabilities list is empty
    return this.tools.map((t) => t.name);
  }

  /**
   * Placeholder planning hook (subclasses may override).
   * @param {string|object} intent
   * @returns {null|object}
   */
  async plan(intent) { // eslint-disable-line no-unused-vars
    return null;
  }
}

export default BaseDomain;