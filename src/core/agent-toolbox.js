import path from 'node:path';
import SkillRegistry from './SkillRegistry.js';

/**
 * Unified skill toolbox for agent and channel integrations.
 *
 * The toolbox intentionally delegates loading, lifecycle, hooks, and execution
 * to SkillRegistry so manifest-based and class-based skills share one path.
 */
class AgentToolbox {
  constructor(config = {}, registry = null) {
    this.config = config;
    this.registry = registry || new SkillRegistry(config);
    this.loaded = false;
  }

  async importSkills(skillsPath = this.config.skillsPath, names = null) {
    const root = path.resolve(skillsPath || path.resolve(process.cwd(), 'src/skills'));
    if (!names || names.length === 0) {
      await this.registry.loadFromDirectory(root);
    } else {
      for (const name of names) {
        const skillPath = path.join(root, name);
        await this.registry.loadSkill(skillPath);
      }
    }
    this.loaded = true;
    return this.list();
  }

  initialize(skillsPath = this.config.skillsPath, names = null) {
    return this.importSkills(skillsPath, names);
  }

  list() {
    return this.registry.list();
  }

  has(name) {
    return this.registry.has(name);
  }

  get(name) {
    return this.registry.get(name);
  }

  tools() {
    return this.registry.getAllToolDefinitions();
  }

  describe() {
    return this.registry.getDescriptions();
  }

  execute(toolName, params = {}, context = {}) {
    if (!toolName || typeof toolName !== 'string') {
      throw new TypeError('AgentToolbox.execute requires a tool name');
    }
    return this.registry.executeTool(toolName, params, context);
  }

  async destroy() {
    await this.registry.destroy();
    this.loaded = false;
  }
}

export default AgentToolbox;
export { AgentToolbox };
