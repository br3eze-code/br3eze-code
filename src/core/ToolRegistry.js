import { logger } from './logger.js';

/**
 * Unified, canonical ToolRegistry.
 *
 * Tool execution stays domain-neutral. Authorization is supplied by the
 * caller/host through opts.permissionPolicy or context.permissionPolicy.
 * No domain-specific permission assumptions live in Core.
 */

const defaultPermissionPolicy = {
  check: (toolName, context = {}, tool = {}) => {
    const required = tool.permissions || tool.requiredPermissions || [];
    if (!required.length) return { allowed: true };

    const granted = context.permissions || context.userPermissions || [];
    const missing = required.filter((permission) => !granted.includes(permission));
    return missing.length
      ? { allowed: false, reason: `Missing permissions: ${missing.join(', ')}` }
      : { allowed: true };
  },
};

const hooks = {
  runBefore: async () => {},
  runAfter: async () => {},
};

class ToolRegistry {
  /**
   * @param {object} opts
   * @param {string} [opts.skillsPath] Path to load skill manifests from (optional)
   * @param {object} [opts.permissionPolicy] Authorization policy with check(name, context, tool)
   */
  constructor(opts = {}) {
    this.tools = new Map();
    this.skills = new Map();
    this.domains = new Set();
    this._skillsPath = opts.skillsPath || null;
    this._manifestCache = null;
    this.permissionPolicy = opts.permissionPolicy || defaultPermissionPolicy;
    this.hooks = opts.hooks || hooks;
    this.logger = logger;
  }

  registerDomain(domainName, toolDefs) {
    if (!Array.isArray(toolDefs)) {
      this.logger.error(`registerDomain(${domainName}): tools must be an array`);
      return;
    }
    this.domains.add(domainName);
    toolDefs.forEach((tool) => {
      const fullName = `${domainName}.${tool.name}`;
      this.tools.set(fullName, { ...tool, domain: domainName, fullName });
      this._manifestCache = null;
    });
    this.logger.info(`ToolRegistry: registered domain "${domainName}" with ${toolDefs.length} tool(s)`);
  }

  register(fullName, toolDef) {
    if (!fullName || typeof fullName !== 'string' || typeof toolDef?.execute !== 'function') {
      throw new TypeError('ToolRegistry.register requires a name and executable tool definition');
    }
    const [domain] = fullName.split('.');
    this.domains.add(domain);
    this.tools.set(fullName, { ...toolDef, domain, fullName });
    this._manifestCache = null;
  }

  async execute(fullToolName, params = [], context = {}) {
    const tool = this.tools.get(fullToolName);
    if (!tool) throw new Error(`Tool not found: ${fullToolName}`);

    const policy = context.permissionPolicy || this.permissionPolicy;
    if (!policy || typeof policy.check !== 'function') {
      throw new Error(`No permission policy configured for: ${fullToolName}`);
    }

    const perm = await policy.check(fullToolName, context, tool);
    if (!perm?.allowed) throw new Error(perm?.reason || `Permission denied: ${fullToolName}`);

    await this.hooks.runBefore(fullToolName, params, context);
    const result = Array.isArray(params)
      ? await tool.execute(context, ...params)
      : await tool.execute(params, context);
    await this.hooks.runAfter(fullToolName, params, result, context);

    return result;
  }

  getTool(name) { return this.tools.get(name); }
  getAllTools() { return Array.from(this.tools.values()); }
  getToolsByDomain(d) { return Array.from(this.tools.values()).filter((t) => t.domain === d); }
  getToolsForDomain(d) { return this.getToolsByDomain(d); }

  getManifest() {
    if (this._manifestCache) return this._manifestCache;
    const toolList = Array.from(this.tools.values()).map((t) => ({
      name: t.fullName,
      description: t.description || t.schema?.description || '',
      parameters: t.schema?.parameters || t.parameters || [],
      returns: t.schema?.returns || 'any',
      domain: t.domain,
      risk: t.risk || t.riskLevel || 'low',
      riskLevel: t.riskLevel || t.risk || 'low',
      auditable: typeof t.audit === 'function',
    }));
    this._manifestCache = {
      version: '2.0.0',
      agent: 'AgentOS',
      domains: Array.from(this.domains),
      tools: toolList,
      safety: {
        maxToolsPerRequest: 10,
        allowedOperations: toolList.map((t) => t.name),
      },
    };
    return this._manifestCache;
  }

  invalidateManifest() { this._manifestCache = null; }
}

const _singleton = new ToolRegistry();

export default _singleton;
export { ToolRegistry };
