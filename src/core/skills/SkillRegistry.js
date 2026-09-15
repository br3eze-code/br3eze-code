import { createRequire } from 'module';
import { logger } from '../logger.js';
const require = createRequire(import.meta.url);

class SkillRegistry {
  constructor() {
    this.skills = new Map();
    this.manifests = new Map();
    this.implementations = new Map();
  }

  async loadFromDirectory(skillsPath, config = {}) {
    const fs = require('fs').promises;
    const path = require('path');
    const entries = await fs.readdir(skillsPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(skillsPath, entry.name);
      try {
        let manifest = null;
        const jsonPath = path.join(dirPath, 'skill.json');
        const yamlPath = path.join(dirPath, 'manifest.yaml');
        if (require('fs').existsSync(jsonPath)) manifest = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
        else if (require('fs').existsSync(yamlPath)) manifest = require('js-yaml').load(await fs.readFile(yamlPath, 'utf8'));
        if (!manifest) continue;
        const entryFile = manifest.entry || 'index.js';
        const codePath = path.join(dirPath, entryFile);
        if (!require('fs').existsSync(codePath)) {
          logger.warn(`Skill ${entry.name} entry file not found: ${entryFile}`);
          continue;
        }
        const skillModule = require(path.resolve(codePath));
        this.register(manifest, skillModule, config);
        logger.info(`Skill loaded: ${manifest.name} v${manifest.version || '1.0.0'}`);
      } catch (err) {
        logger.error(`Failed to load skill ${entry.name}: ${err.stack || err.message || err}`);
      }
    }
  }

  register(manifest, implementation, config = {}) {
    if (!manifest?.name) throw new Error('skill manifest name is required');
    if (implementation?.__esModule && implementation.default !== undefined) implementation = implementation.default;

    const skillConfig = config?.skills?.[manifest.name] || config?.[manifest.name] || {};
    const workspace = config?.workspace || {};
    let executor;

    if (typeof implementation === 'function' && implementation.prototype?.execute) {
      const instance = new implementation(skillConfig, logger, workspace);
      executor = (toolName, args, ctx) => instance.execute(toolName, args, ctx || {});
    } else if (typeof implementation?.execute === 'function') {
      const fn = implementation.execute.bind(implementation);
      executor = fn.length <= 2
        ? (toolName, args, ctx) => fn({ action: toolName, ...(args || {}) }, ctx || {})
        : (toolName, args, ctx) => fn(toolName, args, ctx || {});
    } else if (typeof implementation === 'function') {
      executor = (toolName, args, ctx) => implementation({ action: toolName, ...(args || {}) }, ctx || {});
    } else {
      throw new Error(`Skill "${manifest.name}" has no executable implementation`);
    }

    this.skills.set(manifest.name, {
      manifest,
      execute: executor,
      validate: typeof implementation.validate === 'function' ? implementation.validate : (() => true),
    });
    this.manifests.set(manifest.name, manifest);
    this.implementations.set(manifest.name, implementation);
  }

  async execute(skillName, toolName, args = {}, context = {}) {
    const skill = this.skills.get(skillName);
    if (!skill) throw new Error(`Skill '${skillName}' not found`);
    if (typeof toolName === 'object') {
      context = args || {};
      args = toolName;
      toolName = skillName;
    }
    return skill.execute(toolName, args || {}, context || {});
  }

  /**
   * Canonical dot-notation bridge: `skill.tool`.
   * This is deliberately kept in the registry so every caller uses the same
   * skill -> tool resolution instead of reaching into implementation objects.
   */
  async executeTool(toolName, params = {}, context = {}) {
    if (!toolName || typeof toolName !== 'string') throw new Error('tool name is required');
    const separator = toolName.indexOf('.');
    if (separator <= 0 || separator === toolName.length - 1) {
      throw new Error(`Invalid tool name '${toolName}'; expected skill.tool`);
    }
    const skillName = toolName.slice(0, separator);
    const operation = toolName.slice(separator + 1);
    const skill = this.skills.get(skillName);
    if (!skill) throw new Error(`Skill '${skillName}' not found for tool '${toolName}'`);
    return skill.execute(operation, params || {}, context || {});
  }

  validateParams(params, schema = {}) {
    for (const [key, config] of Object.entries(schema)) {
      if (config.required && !(key in (params || {}))) throw new Error(`Missing required parameter: ${key}`);
    }
  }

  list() { return Array.from(this.manifests.values()); }
  count() { return this.skills.size; }
  has(name) { return this.skills.has(name); }
  get(name) { return this.skills.get(name); }
  getDescriptions() {
    return Array.from(this.skills.values()).map(s => ({ name: s.manifest.name, description: s.manifest.description, version: s.manifest.version }));
  }
}

export default SkillRegistry;
