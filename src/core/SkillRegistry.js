import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import EventEmitter from 'node:events';
import { logger } from './logger.js';

const REQUIRED_MANIFEST_FIELDS = ['name', 'version', 'description'];

/**
 * Canonical AgentOS skill registry.
 *
 * The registry owns discovery, manifest validation, lifecycle, hooks,
 * introspection and execution. Domain/provider implementations are supplied
 * by discovered skills or dependency injection; Core contains no vendors.
 */
export default class SkillRegistry extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.skills = new Map();
    this.hooks = { beforeExecute: [], afterExecute: [], onError: [] };
  }

  async loadFromDirectory(skillsPath) {
    try {
      const entries = await fs.readdir(skillsPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) await this.loadSkill(path.join(skillsPath, entry.name));
      }
      this.emit('loaded', this.skills.size);
      return this;
    } catch (error) {
      if (error.code === 'ENOENT') return this;
      throw error;
    }
  }

  async loadSkill(skillPath) {
    const manifest = await this._loadManifest(skillPath);
    this.validateManifest(manifest);
    const implPath = path.join(skillPath, manifest.entry || 'index.js');
    let implementation = {};
    if (fsSync.existsSync(implPath)) {
      const mod = await import(pathToFileURL(path.resolve(implPath)).href);
      implementation = mod.default || mod;
    }
    this.register(manifest, implementation, { path: skillPath });
    const skill = this.get(manifest.name);
    await skill.initialize(this.config);
    this.emit('skillLoaded', manifest.name);
    return skill;
  }

  async _loadManifest(skillPath) {
    for (const filename of ['manifest.yaml', 'manifest.yml', 'skill.json', 'manifest.json']) {
      const file = path.join(skillPath, filename);
      if (!fsSync.existsSync(file)) continue;
      const raw = await fs.readFile(file, 'utf8');
      if (filename.endsWith('.json')) return JSON.parse(raw);
      const yaml = await import('js-yaml');
      return yaml.default.load(raw);
    }
    throw new Error(`No skill manifest found in ${skillPath}`);
  }

  validateManifest(manifest = {}) {
    for (const field of REQUIRED_MANIFEST_FIELDS) {
      if (!manifest[field]) throw new Error(`Missing required field: ${field}`);
    }
    if (!/^[a-z0-9._-]+$/.test(manifest.name)) throw new Error(`Invalid skill name: ${manifest.name}`);
    if (manifest.permissions !== undefined && !Array.isArray(manifest.permissions)) {
      throw new Error(`Skill '${manifest.name}' permissions must be an array`);
    }
    return true;
  }

  register(nameOrManifest, implementationOrSkill = {}, options = {}) {
    let manifest;
    let implementation;
    if (typeof nameOrManifest === 'object' && nameOrManifest !== null) {
      manifest = { ...nameOrManifest };
      implementation = implementationOrSkill;
    } else {
      const skill = implementationOrSkill || {};
      manifest = {
        name: nameOrManifest,
        description: skill.description || '',
        version: skill.version || '1.0.0',
        permissions: skill.permissions || [],
        parameters: skill.parameters || {},
        tools: skill.tools,
        dispatch: skill.dispatch || null,
        tags: skill.tags || []
      };
      implementation = skill;
    }
    this.validateManifest(manifest);
    const executor = this._normalizeExecutor(manifest, implementation);
    this.skills.set(manifest.name, {
      manifest,
      execute: this.wrapExecution(executor, manifest.name),
      validate: typeof implementation?.validate === 'function' ? implementation.validate.bind(implementation) : this.defaultValidate,
      initialize: typeof implementation?.initialize === 'function' ? implementation.initialize.bind(implementation) : async () => {},
      destroy: typeof implementation?.destroy === 'function' ? implementation.destroy.bind(implementation) : async () => {},
      path: options.path || null,
      implementation
    });
    return this;
  }

  _normalizeExecutor(manifest, implementation) {
    let impl = implementation;
    if (impl?.__esModule && impl.default !== undefined) impl = impl.default;
    if (typeof impl === 'function' && impl.prototype?.execute) {
      const instance = new impl(this.config, logger, this.config.workspace || {});
      return (toolName, args, context) => instance.execute(toolName, args, context || {});
    }
    if (typeof impl?.execute === 'function') {
      const fn = impl.execute.bind(impl);
      if (fn.length <= 2) return (toolName, args, context) => fn({ action: toolName, ...(args || {}) }, context || {});
      return (toolName, args, context) => fn(toolName, args, context || {});
    }
    if (typeof impl === 'function') return (params, context) => impl(params, context);
    return async () => ({ status: 'no-op', skill: manifest.name });
  }

  wrapExecution(executeFn, skillName) {
    return async (...args) => {
      const toolCall = args.length >= 3;
      const params = toolCall ? (args[1] || {}) : (args[0] || {});
      const context = toolCall ? (args[2] || {}) : (args[1] || {});
      for (const hook of this.hooks.beforeExecute) await hook(params, context, skillName);
      try {
        const result = await executeFn(...args);
        for (const hook of this.hooks.afterExecute) await hook(result, context, skillName);
        return result;
      } catch (error) {
        for (const hook of this.hooks.onError) await hook(error, context, skillName);
        throw error;
      }
    };
  }

  validateParams(params = {}, schema = {}) {
    for (const [key, config] of Object.entries(schema || {})) {
      const value = params[key];
      if (config.required && (value === undefined || value === null)) throw new Error(`Missing required parameter: ${key}`);
      if (value !== undefined && config.type) {
        const actual = Array.isArray(value) ? 'array' : typeof value;
        if (actual !== config.type) throw new Error(`Invalid type for ${key}: expected ${config.type}, got ${actual}`);
      }
      if (value !== undefined && config.enum && !config.enum.includes(value)) throw new Error(`Invalid value for ${key}: must be one of ${config.enum.join(', ')}`);
    }
    return true;
  }

  defaultValidate() { return true; }
  get(name) { return this.skills.get(name); }
  has(name) { return this.skills.has(name); }
  count() { return this.skills.size; }
  list() { return [...this.skills.values()].map(({ manifest }) => ({ ...manifest })); }

  getDescriptions() {
    return [...this.skills.values()].map(({ manifest }) => ({
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      parameters: manifest.parameters,
      examples: manifest.examples,
      tools: manifest.tools || []
    }));
  }

  getAllToolDefinitions() {
    const definitions = [];
    for (const { manifest } of this.skills.values()) {
      if (Array.isArray(manifest.tools) && manifest.tools.length) {
        for (const tool of manifest.tools) definitions.push({
          name: tool.name.includes('.') ? tool.name : `${manifest.name}.${tool.name}`,
          description: tool.description,
          parameters: tool.parameters,
          returns: tool.returns
        });
      } else definitions.push({ name: manifest.name, description: manifest.description, parameters: manifest.parameters || {}, returns: 'any' });
    }
    return definitions;
  }

  async execute(skillName, params = {}, context = {}) {
    const skill = this.get(skillName);
    if (!skill) throw new Error(`Skill '${skillName}' not found`);
    return skill.execute(params, context);
  }

  async executeTool(toolFullName, params = {}, context = {}) {
    const [skillName, ...rest] = toolFullName.split('.');
    const skill = this.get(skillName);
    if (!skill) throw new Error(`Skill not found: ${skillName}`);
    return rest.length ? skill.execute(rest.join('.'), params, context) : skill.execute(params, context);
  }

  findByDispatch(dispatchKey) { return [...this.skills.values()].find(skill => skill.manifest.dispatch === dispatchKey) || null; }
  before(fn) { this.hooks.beforeExecute.push(fn); return this; }
  after(fn) { this.hooks.afterExecute.push(fn); return this; }
  addHook(type, handler) { if (!this.hooks[type]) throw new Error(`Unknown skill hook: ${type}`); this.hooks[type].push(handler); return this; }

  async reload(name) {
    const skill = this.get(name);
    if (!skill || !skill.path) throw new Error(`Reload requires a discovered skill: ${name}`);
    await skill.destroy();
    this.skills.delete(name);
    return this.loadSkill(skill.path);
  }

  async initializeAll() {
    for (const skill of this.skills.values()) await skill.initialize(this.config);
    return this;
  }

  async destroy() {
    for (const [name, skill] of this.skills) {
      try { await skill.destroy(); } catch (error) { logger.warn(`Failed to destroy skill ${name}: ${error.message}`); }
    }
    this.skills.clear();
  }
}
