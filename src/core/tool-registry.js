/**
 * @deprecated Compatibility facade.
 *
 * Canonical implementation: ./ToolRegistry.js
 * This file deliberately contains no second tool registry implementation.
 */
import CanonicalToolRegistry from './ToolRegistry.js';
import { ToolNotFoundError, SkillDisabledError } from './tool-errors.js';

class LegacyToolRegistry extends CanonicalToolRegistry {
  constructor(options = {}) {
    super(options);
    this.drivers = this.skills;
    this.skillsPath = options.skillsPath || this.skillsPath;
    this.workspace = options.workspace || this.workspace;
  }

  async loadSkills(skillsPath = this.skillsPath, workspace = this.workspace) {
    this.skillsPath = skillsPath;
    this.workspace = workspace;
    await this.loadFromDirectory(skillsPath);
    return this;
  }

  async execute(name, params = {}, context = {}) {
    const ctx = context && typeof context === 'object' ? context : { userId: context };
    try {
      // Legacy registry executed namespaced tools; the canonical registry
      // exposes that operation explicitly as executeTool().
      if (name.includes('.')) return await super.executeTool(name, params, ctx);
      return await super.execute(name, params, ctx);
    } catch (error) {
      if (error?.message === `Skill not found: ${name}` || error?.message === `Skill '${name}' not found`) {
        throw new ToolNotFoundError(name);
      }
      throw error;
    }
  }
}

export { LegacyToolRegistry as ToolRegistry, ToolNotFoundError, SkillDisabledError };
export default LegacyToolRegistry;
