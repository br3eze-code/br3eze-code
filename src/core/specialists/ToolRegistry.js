/**
 * Specialist tool projection.
 *
 * There is one source of truth for executable tools: Core ToolRegistry.
 * This class only filters that registry for a specialist; it never registers
 * or owns a second tool universe.
 */
import canonicalRegistry, { ToolRegistry as CanonicalToolRegistry } from '../ToolRegistry.js';

export class ToolRegistry {
  constructor({ registry = canonicalRegistry } = {}) {
    if (!registry || typeof registry.getAllTools !== 'function') {
      throw new TypeError('A canonical ToolRegistry is required');
    }
    this.registry = registry;
  }

  getTool(name) { return this.registry.getTool(name) || null; }
  listTools() { return this.registry.getAllTools(); }
  listSkills() { return []; }

  toolsForSpecialist(specialist) {
    const names = new Set(specialist?.tools || []);
    const skills = new Set(specialist?.skills || specialist?.skillNames || []);
    return this.listTools().filter((tool) => (
      tool.specialist === specialist?.role ||
      tool.specialist === specialist?.id ||
      names.has(tool.name) ||
      names.has(tool.fullName) ||
      skills.has(tool.skill)
    ));
  }
}

// Expose the canonical class for callers that need to construct the real registry.
export { CanonicalToolRegistry };
export default ToolRegistry;
