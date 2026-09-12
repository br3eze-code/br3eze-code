import { promises as fsp } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { logger } from './logger.js';

/**
 * Canonical AgentOS ToolRegistry.
 * Owns skill discovery, tool registration/execution, schemas and metrics.
 * Keep domain implementations behind this registry; do not create parallel
 * ToolRegistry implementations elsewhere in core.
 */

function syncExists(filePath) {
  try { fsSync.accessSync(filePath); return true; } catch { return false; }
}
function syncIsDir(filePath) {
  try { return fsSync.statSync(filePath).isDirectory(); } catch { return false; }
}
async function importFresh(filePath) {
  const url = pathToFileURL(filePath);
  url.searchParams.set('reload', Date.now().toString());
  return import(url.href);
}

class ToolRegistry {
  constructor(options = {}) {
    this.skillsPath = options.skillsPath || path.join(process.cwd(), 'src/skills');
    this.workspace = options.workspace || process.cwd();
    this.tools = new Map();
    this.skills = new Map();
    this.hooks = new Map();
    this.domains = new Set();
    this.logger = options.logger || logger;
    this._manifestCache = null;
    this._metrics = new Map();
  }

  registerDomain(domainName, toolDefs = []) {
    if (!domainName || typeof domainName !== 'string') throw new TypeError('domainName is required');
    if (!Array.isArray(toolDefs)) throw new TypeError('toolDefs must be an array');
    this.domains.add(domainName);
    for (const tool of toolDefs) {
      if (!tool?.name || typeof tool.execute !== 'function') {
        throw new TypeError(`Invalid domain tool for "${domainName}": name and execute() are required`);
      }
      const handler = tool.passContext
        ? (args = {}, ctx = {}) => {
            const positional = Array.isArray(args) ? args : [args];
            return tool.execute(...positional, ctx);
          }
        : (args = {}) => {
            const positional = Array.isArray(args) ? args : [args];
            return tool.execute(...positional);
          };
      this.register(`${domainName}.${tool.name}`, {
        ...tool,
        handler,
        domain: domainName,
      });
    }
    return this;
  }

  register(fullName, toolDef = {}) {
    if (!fullName || typeof fullName !== 'string') throw new TypeError('tool name is required');
    if (typeof toolDef.execute !== 'function' && typeof toolDef.handler !== 'function') {
      throw new TypeError(`Tool "${fullName}" must provide execute() or handler()`);
    }
    const [domain] = fullName.split('.');
    const handler = toolDef.handler || toolDef.execute;
    this.domains.add(domain);
    this.tools.set(fullName, { ...toolDef, handler, domain, fullName });
    this._manifestCache = null;
    return this;
  }

  async loadSkills() {
    this.logger.info(`Loading skills from: ${this.skillsPath}`);
    try {
      const entries = await fsp.readdir(this.skillsPath, { withFileTypes: true });
      const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
      await Promise.all(dirs.map((name) => this.loadSkill(name)));
      this.logger.info(`Loaded ${this.skills.size} skills with ${this.tools.size} tools`);
    } catch (error) {
      this.logger.error(`Failed to read skills directory: ${error.message}`);
    }
    return this;
  }

  async loadSkill(skillName) {
    const skillPath = path.join(this.skillsPath, skillName);
    const manifest = await this._resolveManifest(skillPath, skillName);
    if (!manifest) return false;
    try {
      const tools = await this._loadTools(skillPath, manifest);
      const skillHooks = await this._loadHooks(skillPath);
      this.skills.set(manifest.name, { manifest, tools, hooks: skillHooks, path: skillPath, enabled: true, loadedAt: new Date().toISOString() });
      if (skillHooks['on-enable']) await skillHooks['on-enable']({ config: manifest.config || {} });
      this._manifestCache = null;
      return true;
    } catch (error) {
      this.logger.error(`Failed to load skill "${skillName}": ${error.message}`);
      return false;
    }
  }

  async unloadSkill(skillName) {
    const skill = this.skills.get(skillName);
    if (!skill) return false;
    if (skill.hooks['on-disable']) await skill.hooks['on-disable']();
    for (const [name, tool] of this.tools) {
      if (tool.skill === skillName) {
        this.tools.delete(name);
        this._metrics.delete(name);
      }
    }
    this.skills.delete(skillName);
    this._manifestCache = null;
    return true;
  }

  async reloadSkill(skillName) {
    await this.unloadSkill(skillName);
    return this.loadSkill(skillName);
  }

  async execute(fullName, args = {}, ctx = {}) {
    const entry = this.tools.get(fullName);
    if (!entry) throw new ToolNotFoundError(fullName);
    const skill = this.skills.get(entry.skill);
    if (skill && !skill.enabled) throw new SkillDisabledError(entry.skill, fullName);
    const metrics = this._metrics.get(fullName) || { calls: 0, errors: 0, lastCalledAt: null, totalMs: 0 };
    this._metrics.set(fullName, metrics);
    metrics.calls += 1;
    metrics.lastCalledAt = new Date().toISOString();
    const started = Date.now();
    try {
      const result = await entry.handler(args, ctx);
      metrics.totalMs += Date.now() - started;
      return result;
    } catch (error) {
      metrics.errors += 1;
      error.toolName = fullName;
      error.toolArgs = args;
      this.logger.error(`Tool "${fullName}" failed: ${error.message}`);
      throw error;
    }
  }

  search(query, limit = 10) {
    const q = String(query).toLowerCase();
    return [...this.tools.entries()].map(([fullName, entry]) => ({
      fullName,
      entry,
      score: (fullName.toLowerCase().includes(q) ? 2 : 0) + ((entry.schema?.description || '').toLowerCase().includes(q) ? 1 : 0),
    })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)
      .map(({ fullName, entry }) => ({ name: fullName, description: entry.schema?.description || '', skill: entry.skill, risk: entry.schema?.risk || 'low' }));
  }

  getToolsForLLM(skillFilter = null) {
    return [...this.tools.entries()]
      .filter(([, entry]) => !skillFilter || entry.skill === skillFilter)
      .filter(([, entry]) => !this.skills.get(entry.skill) || this.skills.get(entry.skill).enabled)
      .map(([fullName, entry]) => {
        const params = entry.schema?.parameters;
        const properties = {};
        const required = [];
        if (Array.isArray(params)) {
          for (const parameter of params) {
            properties[parameter.name] = { type: parameter.type || 'string', description: parameter.description || '' };
            if (parameter.required) required.push(parameter.name);
          }
        } else if (params && typeof params === 'object') {
          Object.assign(properties, params.properties || {});
          required.push(...(params.required || []));
        }
        return { type: 'function', function: { name: fullName.replace(/\./g, '__'), description: entry.schema?.description || fullName, parameters: { type: 'object', properties, required } } };
      });
  }

  getManifest() {
    if (this._manifestCache) return this._manifestCache;
    const tools = [...this.tools.values()].map((tool) => ({
      name: tool.fullName,
      description: tool.schema?.description || '',
      parameters: tool.schema?.parameters || [],
      returns: tool.schema?.returns || 'any',
      domain: tool.domain,
      skill: tool.skill,
      risk: tool.schema?.risk || tool.risk || 'low',
    }));
    this._manifestCache = { version: '2.0.0', agent: 'AgentOS', domains: [...this.domains], skills: [...this.skills.keys()], tools, safety: { maxToolsPerRequest: 10, allowedOperations: tools.map((tool) => tool.name) } };
    return this._manifestCache;
  }

  invalidateManifest() { this._manifestCache = null; }
  getTool(name) { return this.tools.get(name); }
  getAllTools() { return [...this.tools.values()]; }
  getToolsByDomain(domain) { return [...this.tools.values()].filter((tool) => tool.domain === domain); }
  getToolsForDomain(domain) { return this.getToolsByDomain(domain); }
  getSkillNames() { return [...this.skills.keys()]; }
  getToolCount() { return this.tools.size; }
  getToolsBySkill(skillName) { const skill = this.skills.get(skillName); return skill ? [...skill.tools.values()] : []; }
  getSkill(skillName) { return this.skills.get(skillName) || null; }
  getSkillInfo(skillName) { const skill = this.skills.get(skillName); return skill ? { ...skill.manifest, toolCount: skill.tools.size, enabled: skill.enabled, loadedAt: skill.loadedAt } : null; }
  setSkillEnabled(skillName, enabled) { const skill = this.skills.get(skillName); if (skill) { skill.enabled = Boolean(enabled); this._manifestCache = null; } }
  getMetrics(toolName = null) {
    if (toolName) return this._metrics.get(toolName) || null;
    return Object.fromEntries([...this._metrics.entries()].map(([name, metrics]) => [name, { ...metrics, avgMs: metrics.calls ? Math.round(metrics.totalMs / metrics.calls) : 0 }]));
  }
  listSkillsTable() { return [...this.skills.values()].map((skill) => ({ skill: skill.manifest.name, version: skill.manifest.version || '—', tools: skill.tools.size, enabled: skill.enabled ? '✓' : '✗', loadedAt: skill.loadedAt?.slice(11, 19) || '—' })); }

  async _resolveManifest(skillPath, skillName) {
    const candidates = [[path.join(skillPath, 'manifest.yaml'), 'yaml'], [path.join(skillPath, 'manifest.yml'), 'yaml'], [path.join(skillPath, 'skill.json'), 'json']];
    for (const [file, type] of candidates) {
      try { const raw = await fsp.readFile(file, 'utf8'); return type === 'yaml' ? yaml.load(raw) : JSON.parse(raw); } catch { /* Try next manifest format. */ }
    }
    this.logger.warn(`No manifest found for skill "${skillName}"`);
    return null;
  }

  async _loadTools(skillPath, manifest) {
    const tools = new Map();
    if (!Array.isArray(manifest.tools)) return tools;
    const toolsDir = path.join(skillPath, 'tools');
    const indexPath = path.join(skillPath, 'index.js');
    const hasToolsDir = syncIsDir(toolsDir);
    const hasIndex = syncExists(indexPath);
    let indexModule = null;
    if (!hasToolsDir && hasIndex) {
      try {
        const imported = await importFresh(indexPath);
        const exported = imported.default || imported;
        indexModule = typeof exported === 'function' ? new exported({}, this.logger, this.workspace) : exported;
      } catch (error) { this.logger.warn(`Skill "${manifest.name}": failed to load index.js — ${error.message}`); }
    }
    for (const toolDef of manifest.tools) {
      if (hasToolsDir) {
        const toolPath = path.join(toolsDir, `${toolDef.name.replace(/\./g, '-')}.js`);
        try {
          const imported = await importFresh(toolPath);
          const handler = imported.handler || imported.default || imported;
          if (typeof handler !== 'function') throw new TypeError('tool module does not export a function');
          const entry = { schema: toolDef, handler, skill: manifest.name, fullName: `${manifest.name}.${toolDef.name}` };
          tools.set(toolDef.name, entry); this.tools.set(entry.fullName, entry); this.domains.add(manifest.name);
        } catch (error) { this.logger.error(`Failed to load tool "${toolDef.name}": ${error.message}`); }
      } else if (indexModule && typeof indexModule.execute === 'function') {
        const entry = { schema: toolDef, skill: manifest.name, fullName: `${manifest.name}.${toolDef.name}`, handler: (args = {}, ctx = {}) => indexModule.execute(toolDef.name, args, ctx) };
        tools.set(toolDef.name, entry); this.tools.set(entry.fullName, entry); this.domains.add(manifest.name);
      } else {
        this.logger.warn(`Skill "${manifest.name}": no tools/ directory and no execute() — skipping "${toolDef.name}"`);
      }
    }
    return tools;
  }

  async _loadHooks(skillPath) {
    const hooks = {};
    const hooksDir = path.join(skillPath, 'hooks');
    try {
      const files = await fsp.readdir(hooksDir);
      for (const file of files.filter((name) => name.endsWith('.js'))) {
        const imported = await importFresh(path.join(hooksDir, file));
        hooks[path.basename(file, '.js')] = imported.default || imported;
      }
    } catch { /* Hooks are optional. */ }
    return hooks;
  }
}

class ToolNotFoundError extends Error {
  constructor(name) { super(`Tool not found: "${name}"`); this.name = 'ToolNotFoundError'; this.toolName = name; }
}
class SkillDisabledError extends Error {
  constructor(skill, tool) { super(`Skill "${skill}" is disabled — cannot execute tool "${tool}"`); this.name = 'SkillDisabledError'; this.skillName = skill; this.toolName = tool; }
}

export { ToolRegistry, ToolNotFoundError, SkillDisabledError };
export default ToolRegistry;
