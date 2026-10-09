import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { logger } from '../logger.js';
import { getTaskRegistry } from '../taskRegistry.js';
import { describeCapability, checkCapabilityBoundary, createExecutionIntent } from '../capability-boundary.js';

<<<<<<< HEAD
async function importFresh(filePath) {
  const url = pathToFileURL(path.resolve(filePath));
  url.searchParams.set('reload', Date.now().toString());
  return import(url.href);
}

class SkillRegistry {
  constructor(options = {}) {
    this.skills = new Map();
    this.manifests = new Map();
    this.implementations = new Map();
    this.taskRegistry = options.taskRegistry || getTaskRegistry();
    this.requireExecutionTask = options.requireExecutionTask !== false;
  }

  async loadFromDirectory(skillsPath, config = {}) {
=======
class SkillRegistry {
  constructor() {
    this.skills = new Map();
    this.manifests = new Map();
    this.implementations = new Map();
  }

  async loadFromDirectory(skillsPath, config = {}) {
    const fs = require('fs').promises;
    const path = require('path');
>>>>>>> origin/main
    const entries = await fs.readdir(skillsPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(skillsPath, entry.name);
      try {
<<<<<<< HEAD
        const jsonPath = path.join(dirPath, 'skill.json');
        const yamlPath = path.join(dirPath, 'manifest.yaml');
        let manifest = null;
        if (existsSync(jsonPath)) manifest = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
        else if (existsSync(yamlPath)) manifest = yaml.load(await fs.readFile(yamlPath, 'utf8'));
        if (!manifest) continue;
        const entryFile = manifest.entry || 'index.js';
        const codePath = path.join(dirPath, entryFile);
        if (!existsSync(codePath)) { logger.warn(`Skill ${entry.name} entry file not found: ${entryFile}`); continue; }
        const imported = await importFresh(codePath);
        const implementation = imported.default || imported;
        this.register(manifest, implementation, config);
        logger.info(`Skill loaded: ${manifest.name} v${manifest.version || '1.0.0'}`);
      } catch (error) { logger.error(`Failed to load skill ${entry.name}: ${error.stack || error.message || error}`); }
=======
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
>>>>>>> origin/main
    }
  }

  register(manifest, implementation, config = {}) {
<<<<<<< HEAD
    if (!manifest?.name) throw new TypeError('Skill manifest requires a name');
    let executor;
    const skillConfig = config?.skills?.[manifest.name] || config?.[manifest.name] || {};
    const workspace = config?.workspace || {};
=======
    if (!manifest?.name) throw new Error('skill manifest name is required');
    if (implementation?.__esModule && implementation.default !== undefined) implementation = implementation.default;

    const skillConfig = config?.skills?.[manifest.name] || config?.[manifest.name] || {};
    const workspace = config?.workspace || {};
    let executor;

>>>>>>> origin/main
    if (typeof implementation === 'function' && implementation.prototype?.execute) {
      const instance = new implementation(skillConfig, logger, workspace);
      executor = (toolName, args, ctx) => instance.execute(toolName, args, ctx || {});
    } else if (typeof implementation?.execute === 'function') {
      const fn = implementation.execute.bind(implementation);
<<<<<<< HEAD
      executor = fn.length <= 2 ? (toolName, args, ctx) => fn({ action: toolName, ...(args || {}) }, ctx || {}) : (toolName, args, ctx) => fn(toolName, args, ctx || {});
    } else if (typeof implementation === 'function') executor = (params, ctx) => implementation(params, ctx);
    else { logger.warn(`Skill "${manifest.name}": no execute implementation found — registering as no-op`); executor = () => ({ status: 'no-op', skill: manifest.name }); }
    const validate = typeof implementation?.validate === 'function' ? implementation.validate.bind(implementation) : () => true;
    this.skills.set(manifest.name, { manifest, execute: executor, validate });
=======
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
>>>>>>> origin/main
    this.manifests.set(manifest.name, manifest);
    this.implementations.set(manifest.name, implementation);
  }

<<<<<<< HEAD
  _gate(skillName, toolName, args, context = {}) {
    const taskId = context.taskId || context.execution?.taskId;
    const task = taskId ? this.taskRegistry.get(taskId) : null;
    if (this.requireExecutionTask && !task) return { allowed: false, errors: ['execution_task_required'] };
    const phase = context.phase || task?.execution?.phase || 'execute';
    if (phase !== 'execute') return { allowed: false, errors: [`task_not_executable:${phase}`] };
    const manifest = this.manifests.get(skillName) || {};
    const policy = manifest.capability || manifest.capabilities?.find?.((item) => item.tool === toolName || item.id === toolName) || {};
    const capability = describeCapability({
      id: policy.id || `${skillName}.${toolName}`,
      domain: policy.domain || manifest.domain || skillName,
      skill: skillName,
      tool: toolName,
      phase: policy.phase || 'execute',
      risk: policy.risk || manifest.risk || 'low',
      requiresApproval: policy.requiresApproval,
      permissions: policy.permissions || [],
    });
    const approved = task?.execution?.approved === true || context.approvalGranted === true;
    const boundary = checkCapabilityBoundary(capability, context, { phase, approved });
    const intent = createExecutionIntent({ taskId: task?.taskId || taskId, wbsId: context.wbsId || task?.wbs?.id || null, capability, context: { ...context, approvalGranted: approved }, input: args, phase });
    return { ...boundary, task, intent };
  }

  async execute(skillName, toolName, args = {}, context = {}) {
    const skill = this.skills.get(skillName);
    if (!skill) throw new Error(`Skill '${skillName}' not found`);
    let actualToolName = toolName; let actualArgs = args; let actualContext = context;
    if (typeof toolName === 'object') { actualToolName = skillName; actualArgs = toolName; actualContext = args || {}; }
    const gate = this._gate(skillName, actualToolName, actualArgs, actualContext);
    if (!gate.allowed) {
      const error = new Error(`Capability boundary blocked skill "${skillName}": ${gate.errors.join(', ')}`);
      error.name = 'CapabilityBoundaryError'; error.errors = gate.errors; error.intent = gate.intent || null; throw error;
    }
    this.taskRegistry.checkpoint(gate.task.taskId, { type: 'skill-execution-start', capability: gate.intent.capability.id, intentId: gate.intent.intentId });
    try {
      const result = await skill.execute(actualToolName, actualArgs, actualContext);
      this.taskRegistry.checkpoint(gate.task.taskId, { type: 'skill-execution-result', capability: gate.intent.capability.id, intentId: gate.intent.intentId, success: true });
      return result;
    } catch (error) {
      this.taskRegistry.checkpoint(gate.task.taskId, { type: 'skill-execution-result', capability: gate.intent.capability.id, intentId: gate.intent.intentId, success: false, error: error.message });
      throw error;
    }
  }

  validateParams(params, schema) { for (const [key, config] of Object.entries(schema || {})) if (config.required && !(key in params)) throw new Error(`Missing required parameter: ${key}`); }
  list() { return [...this.manifests.values()]; }
  count() { return this.skills.size; }
  has(name) { return this.skills.has(name); }
  get(name) { return this.skills.get(name); }
  getDescriptions() { return [...this.skills.values()].map((skill) => ({ name: skill.manifest.name, description: skill.manifest.description, version: skill.manifest.version })); }
}

export default SkillRegistry;
export { SkillRegistry };
=======
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
>>>>>>> origin/main
