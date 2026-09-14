/**
 * @deprecated Legacy compatibility facade.
 *
 * The registry implementation moved to src/core/SkillRegistry.js. This file
 * only supplies the historical built-in-skill loader contract so older entry
 * points can migrate without carrying a second registry implementation.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SkillRegistry from '../src/core/SkillRegistry.js';

class LegacySkillRegistryFacade extends SkillRegistry {
  async loadBuiltinSkills() {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    await this.loadFromDirectory(dir);
    return this;
  }
}

export default new LegacySkillRegistryFacade();
