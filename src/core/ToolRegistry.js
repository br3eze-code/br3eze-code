import { logger } from './logger.js';
import { promises as fsp } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

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

export class ToolNotFoundError extends Error {
  constructor(name) { super(`Tool not found: "${name}"`); this.name = 'ToolNotFoundError'; this.toolName = name; }
}

export class SkillDisabledError extends Error {
  constructor(skill, tool) { super(`Skill "${skill}" is disabled — cannot execute tool "${tool}"`); this.name = 'SkillDisabledError'; this.skillName = skill; this.toolName = tool; }
}

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
    this.logger = opts.logger || logger;
    this._metrics = new Map();
    if (Array.isArray(opts.skills)) for (const skill of opts.skills) this.registerSkill(skill);
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

  registerTool(toolDef) {
    if (!toolDef || !toolDef.name) throw new TypeError('registerTool requires { name, execute|handler }');
    const handler = typeof toolDef.handler === 'function' ? toolDef.handler : toolDef.execute;
    if (typeof handler !== 'function') throw new TypeError(`Tool "${toolDef.name}" requires execute or handler`);
    const entry = { ...toolDef, execute: handler, handler, fullName: toolDef.fullName || toolDef.name, domain: toolDef.domain || null };
    if (this.tools.has(entry.fullName)) throw new Error(`Tool "${entry.fullName}" already registered`);
    this.tools.set(entry.fullName, entry);
    if (entry.domain) this.domains.add(entry.domain);
    this._manifestCache = null;
    return this;
  }

  registerSkill(skill) {
    if (!skill?.name) throw new TypeError('registerSkill requires { name }');
    if (this.skills.has(skill.name)) throw new Error(`Skill "${skill.name}" already registered`);
    this.skills.set(skill.name, skill);
    for (const tool of skill.tools || []) this.registerTool({ ...tool, skill: skill.name, fullName: tool.fullName || `${skill.name}.${tool.name}` });
    this._manifestCache = null;
    return this;
  }

  getSkillNames() { return Array.from(this.skills.keys()); }
  getDescriptions() {
    return this.listSkills().map((skill) => ({
      name: skill.name,
      description: skill.description || skill.manifest?.description || '',
      version: skill.version || skill.manifest?.version || null,
      parameters: skill.parameters || skill.manifest?.parameters || {},
      tools: (skill.tools || []).map((tool) => tool.fullName || tool.name),
    }));
  }
  async initializeSkill(skillName, context = {}) {
    const skill = this.skills.get(skillName);
    if (!skill) throw new Error('Skill "' + skillName + '" not found');
    if (typeof skill.initialize === 'function' && !skill.initialized) {
      await skill.initialize(context);
      skill.initialized = true;
    }
    return skill;
  }
  async destroy() {
    for (const skill of this.skills.values()) {
      if (typeof skill.destroy === 'function') await skill.destroy();
    }
    this.skills.clear();
    this.tools.clear();
    this.invalidateManifest();
  }
  getToolCount() { return this.tools.size; }
  getToolsBySkill(skillName) { return Array.from(this.tools.values()).filter((tool) => tool.skill === skillName || tool.fullName?.startsWith(`${skillName}.`)); }
  setSkillEnabled(skillName, enabled) { const skill = this.skills.get(skillName); if (skill) { skill.enabled = Boolean(enabled); this.invalidateManifest(); } }
  getSkillInfo(skillName) { const skill = this.skills.get(skillName); return skill ? { ...(skill.manifest || skill), toolCount: this.getToolsBySkill(skillName).length, enabled: skill.enabled !== false } : null; }

  async loadSkills() {
    if (!this._skillsPath) return false;
    const entries = await fsp.readdir(this._skillsPath, { withFileTypes: true });
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => this.loadSkill(entry.name)));
    return true;
  }

  async loadSkill(skillName) {
    if (!this._skillsPath) return false;
    const skillPath = path.join(this._skillsPath, skillName);
    const manifest = await this._loadManifest(skillPath, skillName);
    if (!manifest) return false;
    const skill = { ...manifest, manifest, name: manifest.name || skillName, enabled: true, tools: [], initialized: false, initialize: async () => {}, destroy: async () => {} };
    const toolsDir = path.join(skillPath, 'tools');
    const hasToolsDir = fsSync.existsSync(toolsDir) && fsSync.statSync(toolsDir).isDirectory();
    const indexPath = path.join(skillPath, 'index.js');
    let indexModule = null;
    if (!hasToolsDir && fsSync.existsSync(indexPath)) {
      delete require.cache[require.resolve(indexPath)];
      const mod = require(indexPath);
      indexModule = mod?.default || mod;
      if (typeof indexModule === 'function') indexModule = new indexModule({}, this.logger);
    }
    for (const def of manifest.tools || []) {
      const fullName = `${skill.name}.${def.name}`;
      let handler = null;
      if (hasToolsDir) {
        const file = path.join(toolsDir, `${def.name.replace(/\\./g, '-')}.js`);
        if (fsSync.existsSync(file)) {
          delete require.cache[require.resolve(file)];
          const mod = require(file);
          handler = mod?.handler || mod?.default || mod;
        }
      } else if (indexModule?.execute) {
        handler = (args = {}, ctx = {}) => indexModule.execute(def.name, args, ctx);
      }
      if (typeof handler !== 'function') continue;
      const entry = { ...def, schema: def, name: fullName, fullName, skill: skill.name, handler, execute: handler };
      this.tools.set(fullName, entry);
      skill.tools.push(entry);
    }
    if (typeof indexModule?.initialize === 'function') {
      skill.initialize = async (context = {}) => {
        await indexModule.initialize(context);
        skill.initialized = true;
      };
    }
    if (typeof indexModule?.destroy === 'function') skill.destroy = async () => indexModule.destroy();
    if (typeof indexModule?.validate === 'function') skill.validate = indexModule.validate.bind(indexModule);
    await skill.initialize({ skill, registry: this, logger: this.logger });
    this.skills.set(skill.name, skill);
    this.invalidateManifest();
    return true;
  }

  async _loadManifest(skillPath, skillName) {
    for (const candidate of ['manifest.yaml', 'manifest.yml', 'skill.json']) {
      const file = path.join(skillPath, candidate);
      try {
        const raw = await fsp.readFile(file, 'utf8');
        return candidate.endsWith('.json') ? JSON.parse(raw) : yaml.load(raw);
      } catch {}
    }
    this.logger.warn(`No manifest found for skill "${skillName}"`);
    return null;
  }

  getToolsForLLM(skillFilter = null) {
    return this.getAllTools().filter((tool) => !skillFilter || tool.skill === skillFilter).map((tool) => ({ type: 'function', function: { name: tool.fullName.replace(/\\./g, '__'), description: tool.description || tool.schema?.description || tool.fullName, parameters: tool.schema?.parameters || tool.parameters || { type: 'object', properties: {} } } }));
  }

  getMetrics(toolName = null) {
    if (toolName) return this._metrics.get(toolName) || null;
    return Object.fromEntries([...this._metrics].map(([name, metric]) => [name, { ...metric, avgMs: metric.calls ? Math.round(metric.totalMs / metric.calls) : 0 }]));
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
    if (!tool) throw new ToolNotFoundError(fullToolName);
    if (this.skills.get(tool.skill)?.enabled === false) throw new SkillDisabledError(tool.skill, fullToolName);
    const metric = this._metrics.get(fullToolName) || { calls: 0, errors: 0, totalMs: 0, lastCalledAt: null };
    metric.calls++; metric.lastCalledAt = new Date().toISOString();
    const started = Date.now();

    const policy = context.permissionPolicy || this.permissionPolicy;
    if (!policy || typeof policy.check !== 'function') {
      throw new Error(`No permission policy configured for: ${fullToolName}`);
    }

    const perm = await policy.check(fullToolName, context, tool);
    if (!perm?.allowed) throw new Error(perm?.reason || `Permission denied: ${fullToolName}`);

    await this.hooks.runBefore(fullToolName, params, context);
    try {
      const result = Array.isArray(params)
        ? await tool.execute(context, ...params)
        : await tool.execute(params, context);
      metric.totalMs += Date.now() - started;
      this._metrics.set(fullToolName, metric);
      await this.hooks.runAfter(fullToolName, params, result, context);
      return result;
    } catch (error) {
      metric.errors++;
      metric.totalMs += Date.now() - started;
      this._metrics.set(fullToolName, metric);
      throw error;
    }
  }

  getTool(name) { return this.tools.get(name) || null; }
  getAllTools() { return Array.from(this.tools.values()); }
  listTools() { return this.getAllTools(); }
  listSkills() { return Array.from(this.skills.values()); }
  matchFastPath(input) {
    for (const skill of this.skills.values()) {
      if (typeof skill.match !== 'function') continue;
      try {
        const hit = skill.match(input);
        if (hit?.tool && this.tools.has(hit.tool)) return { tool: hit.tool, args: hit.args || {} };
        if (hit?.tool && this.tools.has(`${skill.name}.${hit.tool}`)) return { tool: `${skill.name}.${hit.tool}`, args: hit.args || {} };
      } catch {}
    }
    return null;
  }
  toolDeclarations() {
    return this.getAllTools().map((tool) => ({
      name: tool.fullName || tool.name,
      description: tool.description || tool.schema?.description || '',
      parameters: tool.parameters || tool.schema?.parameters || { type: 'object', properties: {} },
      inputSchema: tool.inputSchema || tool.schema?.parameters || tool.parameters || { type: 'object', properties: {} },
      outputSchema: tool.outputSchema || null,
      specialist: tool.specialist || null,
      permissions: tool.permissions || [],
      ticketTypes: tool.ticketTypes || [],
      risk: tool.risk || tool.riskLevel || 'low',
    }));
  }
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
