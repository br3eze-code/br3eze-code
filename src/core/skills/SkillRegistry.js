import { createRequire } from 'module';
import { logger } from '../logger.js';
const require = createRequire(import.meta.url);

// src/core/skills/SkillRegistry.js

class SkillRegistry {
  constructor() {
    this.skills = new Map();
    this.manifests = new Map();
    this.implementations = new Map(); // skillName -> implementation class/object for static introspection
  }

  async loadFromDirectory(skillsPath, config = {}) {
    const fs = require('fs').promises;
    const path = require('path');

    const entries = await fs.readdir(skillsPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dirPath = path.join(skillsPath, entry.name);
        let manifest = null;

        try {
          // Try skill.json first, then manifest.yaml
          const jsonPath = path.join(dirPath, 'skill.json');
          const yamlPath = path.join(dirPath, 'manifest.yaml');

          if (require('fs').existsSync(jsonPath)) {
            manifest = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
          } else if (require('fs').existsSync(yamlPath)) {
            const yaml = require('js-yaml');
            manifest = yaml.load(await fs.readFile(yamlPath, 'utf8'));
          }

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
  }

  register(manifest, implementation, config = {}) {
    let executor;
    const skillConfig = config?.skills?.[manifest.name] || config?.[manifest.name] || {};
    const workspace = config?.workspace || {};

    // require()-of-ESM interop wraps a `export default X` module as
    // {__esModule: true, default: X} instead of returning X directly —
    // unwrap it so class-based skills (the common case) are still detected
    // below. Plain CJS `module.exports = X` has no __esModule flag and
    // passes through unchanged.
    if (implementation && implementation.__esModule && implementation.default !== undefined) {
      implementation = implementation.default;
    }

    if (typeof implementation === 'function' && implementation.prototype?.execute) {
      const instance = new implementation(skillConfig, logger, workspace);
      executor = (toolName, args, ctx) => instance.execute(toolName, args, ctx || {});
    } else if (typeof implementation?.execute === 'function') {
      const fn = implementation.execute.bind(implementation);
      if (fn.length <= 2) {
        executor = (toolName, args, ctx) =>
          fn({ action: toolName, ...(args || {}) }, ctx || {});
      } else {
        executor = (toolName, args, ctx) => fn(toolName, args, ctx || {});
      }
    } else if (typeof implementation === 'function') {
      executor = (params, ctx) => implementation(params, ctx);
    } else {
      logger.warn(`Skill "${manifest.name}": no execute implementation found — registering as no-op`);
      executor = () => ({ status: 'no-op', skill: manifest.name });
    }

    // `implementation` can legitimately be null/undefined when a malformed
    // skill was discovered. Never dereference it while constructing the
    // registry entry; the old code crashed here after logging the no-op warning.
    const validate = typeof implementation?.validate === 'function'
      ? implementation.validate.bind(implementation)
      : () => true;

    this.skills.set(manifest.name, {
      manifest,
      execute: executor,
      validate
    });
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

    return await skill.execute(actualToolName, actualArgs, actualContext);
  }

  validateParams(params, schema) {
    for (const [key, config] of Object.entries(schema)) {
      if (config.required && !(key in params)) {
        throw new Error(`Missing required parameter: ${key}`);
      }
    }
  }

  list() {
    return Array.from(this.manifests.values());
  }

  count() {
    return this.skills.size;
  }

  has(name) {
    return this.skills.has(name);
  }

  get(name) {
    return this.skills.get(name);
  }

  getDescriptions() {
    return Array.from(this.skills.values()).map(s => ({
      name: s.manifest.name,
      description: s.manifest.description,
      version: s.manifest.version
    }));
  }
}

export default SkillRegistry;
