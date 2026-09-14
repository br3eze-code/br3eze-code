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
    // Legacy consumers used these aliases.
    this.drivers = this.skills;
    this.skillsPath = options.skillsPath || this.skillsPath;
    this.workspace = options.workspace || this.workspace;
  }

  /** Compatibility with the old directory loader. */
  async loadSkills(skillsPath = this.skillsPath, workspace = this.workspace) {
    this.skillsPath = skillsPath;
    this.workspace = workspace;
    await this.loadFromDirectory(skillsPath);
    return this;
  }

  /** Compatibility with callers that pass a user id as the third argument. */
  async execute(name, params = {}, context = {}) {
    const ctx = context && typeof context === 'object' ? context : { userId: context };
    try {
      return await super.execute(name, params, ctx);
    } catch (error) {
      if (error?.message === `Tool '${name}' not found`) {
        throw new ToolNotFoundError(name);
      }
      throw error;
    }
  }
}

export { LegacyToolRegistry as ToolRegistry, ToolNotFoundError, SkillDisabledError };
export default LegacyToolRegistry;
