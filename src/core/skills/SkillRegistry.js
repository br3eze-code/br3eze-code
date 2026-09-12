import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { logger } from '../logger.js';

async function importFresh(filePath) {
  const url = pathToFileURL(path.resolve(filePath));
  url.searchParams.set('reload', Date.now().toString());
  return import(url.href);
}

class SkillRegistry {
  constructor() {
    this.skills = new Map();
    this.manifests = new Map();
    this.implementations = new Map();
  }

  async loadFromDirectory(skillsPath, config = {}) {
    const entries = await fs.readdir(skillsPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(skillsPath, entry.name);
      try {
        const jsonPath = path.join(dirPath, 'skill.json');
        const yamlPath = path.join(dirPath, 'manifest.yaml');
        let manifest = null;
        if (existsSync(jsonPath)) manifest = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
        else if (existsSync(yamlPath)) manifest = yaml.load(await fs.readFile(yamlPath, 'utf8'));
        if (!manifest) continue;

        const entryFile = manifest.entry || 'index.js';
        const codePath = path.join(dirPath, entryFile);
        if (!existsSync(codePath)) {
          logger.warn(`Skill ${entry.name} entry file not found: ${entryFile}`);
          continue;
        }

        const imported = await importFresh(codePath);
        const implementation = imported.default || imported;
        this.register(manifest, implementation, config);
        logger.info(`Skill loaded: ${manifest.name} v${manifest.version || '1.0.0'}`);
      } catch (error) {
        logger.error(`Failed to load skill ${entry.name}: ${error.stack || error.message || error}`);
      }
    }
  }

  register(manifest, implementation, config = {}) {
    if (!manifest?.name) throw new TypeError('Skill manifest requires a name');
    let executor;
    const skillConfig = config?.skills?.[manifest.name] || config?.[manifest.name] || {};
    const workspace = config?.workspace || {};

    if (typeof implementation === 'function' && implementation.prototype?.execute) {
      const instance = new implementation(skillConfig, logger, workspace);
      executor = (toolName, args, ctx) => instance.execute(toolName, args, ctx || {});
    } else if (typeof implementation?.execute === 'function') {
      const fn = implementation.execute.bind(implementation);
      executor = fn.length <= 2
        ? (toolName, args, ctx) => fn({ action: toolName, ...(args || {}) }, ctx || {})
        : (toolName, args, ctx) => fn(toolName, args, ctx || {});
    } else if (typeof implementation === 'function') {
      executor = (params, ctx) => implementation(params, ctx);
    } else {
      logger.warn(`Skill "${manifest.name}": no execute implementation found — registering as no-op`);
      executor = () => ({ status: 'no-op', skill: manifest.name });
    }

    const validate = typeof implementation?.validate === 'function'
      ? implementation.validate.bind(implementation)
      : () => true;

    this.skills.set(manifest.name, { manifest, execute: executor, validate });
    this.manifests.set(manifest.name, manifest);
    this.implementations.set(manifest.name, implementation);
  }

  async execute(skillName, toolName, args = {}, context = {}) {
    const skill = this.skills.get(skillName);
    if (!skill) throw new Error(`Skill '${skillName}' not found`);
    let actualToolName = toolName;
    let actualArgs = args;
    let actualContext = context;
    if (typeof toolName === 'object') {
      actualToolName = skillName;
      actualArgs = toolName;
      actualContext = args || {};
    }
    return skill.execute(actualToolName, actualArgs, actualContext);
  }

  validateParams(params, schema) {
    for (const [key, config] of Object.entries(schema || {})) {
      if (config.required && !(key in params)) throw new Error(`Missing required parameter: ${key}`);
    }
  }

  list() { return [...this.manifests.values()]; }
  count() { return this.skills.size; }
  has(name) { return this.skills.has(name); }
  get(name) { return this.skills.get(name); }
  getDescriptions() {
    return [...this.skills.values()].map((skill) => ({ name: skill.manifest.name, description: skill.manifest.description, version: skill.manifest.version }));
  }
}

export default SkillRegistry;
export { SkillRegistry };
