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

export class ToolNotFoundError extends Error {\n  constructor(name) { super(`Tool not found: "${name}"`); this.name = 'ToolNotFoundError'; this.toolName = name; }\n}\n\nexport class SkillDisabledError extends Error {\n  constructor(skill, tool) { super(`Skill "${skill}" is disabled — cannot execute tool "${tool}"`); this.name = 'SkillDisabledError'; this.skillName = skill; this.toolName = tool; }\n}\n\nclass ToolRegistry {
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

  registerTool(toolDef) {\n    if (!toolDef || !toolDef.name) throw new TypeError('registerTool requires { name, execute|handler }');\n    const handler = typeof toolDef.handler === 'function' ? toolDef.handler : toolDef.execute;\n    if (typeof handler !== 'function') throw new TypeError(`Tool "${toolDef.name}" requires execute or handler`);\n    const entry = { ...toolDef, execute: handler, handler, fullName: toolDef.fullName || toolDef.name, domain: toolDef.domain || null };\n    if (this.tools.has(entry.fullName)) throw new Error(`Tool "${entry.fullName}" already registered`);\n    this.tools.set(entry.fullName, entry);\n    if (entry.domain) this.domains.add(entry.domain);\n    this._manifestCache = null;\n    return this;\n  }\n\n  registerSkill(skill) {\n    if (!skill?.name) throw new TypeError('registerSkill requires { name }');\n    if (this.skills.has(skill.name)) throw new Error(`Skill "${skill.name}" already registered`);\n    this.skills.set(skill.name, skill);\n    for (const tool of skill.tools || []) this.registerTool({ ...tool, skill: skill.name, fullName: tool.fullName || `${skill.name}.${tool.name}` });\n    this._manifestCache = null;\n    return this;\n  }\n\n  getSkillNames() { return Array.from(this.skills.keys()); }\n  getToolCount() { return this.tools.size; }\n  getToolsBySkill(skillName) { return Array.from(this.tools.values()).filter((tool) => tool.skill === skillName || tool.fullName?.startsWith(`${skillName}.`)); }\n  setSkillEnabled(skillName, enabled) { const skill = this.skills.get(skillName); if (skill) { skill.enabled = Boolean(enabled); this.invalidateManifest(); } }\n  getSkillInfo(skillName) { const skill = this.skills.get(skillName); return skill ? { ...(skill.manifest || skill), toolCount: this.getToolsBySkill(skillName).length, enabled: skill.enabled !== false } : null; }\n\n  async loadSkills() {\n    if (!this._skillsPath) return false;\n    const entries = await fsp.readdir(this._skillsPath, { withFileTypes: true });\n    await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => this.loadSkill(entry.name)));\n    return true;\n  }\n\n  async loadSkill(skillName) {\n    if (!this._skillsPath) return false;\n    const skillPath = path.join(this._skillsPath, skillName);\n    const manifest = await this._loadManifest(skillPath, skillName);\n    if (!manifest) return false;\n    const skill = { ...manifest, manifest, name: manifest.name || skillName, enabled: true, tools: [] };\n    const toolsDir = path.join(skillPath, 'tools');\n    const hasToolsDir = fsSync.existsSync(toolsDir) && fsSync.statSync(toolsDir).isDirectory();\n    const indexPath = path.join(skillPath, 'index.js');\n    let indexModule = null;\n    if (!hasToolsDir && fsSync.existsSync(indexPath)) {\n      delete require.cache[require.resolve(indexPath)];\n      const mod = require(indexPath);\n      indexModule = mod?.default || mod;\n      if (typeof indexModule === 'function') indexModule = new indexModule({}, this.logger);\n    }\n    for (const def of manifest.tools || []) {\n      const fullName = `${skill.name}.${def.name}`;\n      let handler = null;\n      if (hasToolsDir) {\n        const file = path.join(toolsDir, `${def.name.replace(/\\./g, '-')}.js`);\n        if (fsSync.existsSync(file)) {\n          delete require.cache[require.resolve(file)];\n          const mod = require(file);\n          handler = mod?.handler || mod?.default || mod;\n        }\n      } else if (indexModule?.execute) {\n        handler = (args = {}, ctx = {}) => indexModule.execute(def.name, args, ctx);\n      }\n      if (typeof handler !== 'function') continue;\n      const entry = { ...def, schema: def, name: fullName, fullName, skill: skill.name, handler, execute: handler };\n      this.tools.set(fullName, entry);\n      skill.tools.push(entry);\n    }\n    this.skills.set(skill.name, skill);\n    this.invalidateManifest();\n    return true;\n  }\n\n  async _loadManifest(skillPath, skillName) {\n    for (const candidate of ['manifest.yaml', 'manifest.yml', 'skill.json']) {\n      const file = path.join(skillPath, candidate);\n      try {\n        const raw = await fsp.readFile(file, 'utf8');\n        return candidate.endsWith('.json') ? JSON.parse(raw) : yaml.load(raw);\n      } catch {}\n    }\n    this.logger.warn(`No manifest found for skill "${skillName}"`);\n    return null;\n  }\n\n  getToolsForLLM(skillFilter = null) {\n    return this.getAllTools().filter((tool) => !skillFilter || tool.skill === skillFilter).map((tool) => ({ type: 'function', function: { name: tool.fullName.replace(/\\./g, '__'), description: tool.description || tool.schema?.description || tool.fullName, parameters: tool.schema?.parameters || tool.parameters || { type: 'object', properties: {} } } }));\n  }\n\n  getMetrics(toolName = null) {\n    if (toolName) return this._metrics.get(toolName) || null;\n    return Object.fromEntries([...this._metrics].map(([name, metric]) => [name, { ...metric, avgMs: metric.calls ? Math.round(metric.totalMs / metric.calls) : 0 }]));\n  }\n\n  register(fullName, toolDef) {
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
