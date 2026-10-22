/**
 * Specialist-scoped ownership index.
 *
 * This registry answers which specialist may reference which registered
 * capability. It does not discover, execute, or globally register tools;
 * execution remains owned by the canonical ToolRegistry and AgentRuntime.
 */
export class SpecialistToolRegistry {
  constructor({ skills = [] } = {}) {
    this.skills = new Map();
    this.tools = new Map();
    for (const skill of skills) this.registerSkill(skill);
  }

  registerSkill(skill) {
    if (!skill?.name) throw new TypeError('skill name is required');
    if (this.skills.has(skill.name)) throw new Error(`Skill "${skill.name}" already registered`);
    this.skills.set(skill.name, skill);
    for (const tool of skill.tools || []) {
      if (!tool?.name) throw new TypeError('tool name is required');
      if (this.tools.has(tool.name)) throw new Error(`Tool "${tool.name}" already registered`);
      this.tools.set(tool.name, {
        ...tool,
        skill: skill.name,
        specialist: tool.specialist || skill.specialist || null,
      });
    }
    return this;
  }

  getSkill(name) { return this.skills.get(name) || null; }
  getTool(name) { return this.tools.get(name) || null; }
  listSkills() { return [...this.skills.values()]; }
  listTools() { return [...this.tools.values()]; }

  toolsForSpecialist(specialist) {
    const names = new Set(specialist?.tools || []);
    const skills = new Set(specialist?.skills || specialist?.skillNames || []);
    return this.listTools().filter((tool) => (
      tool.specialist === specialist?.role
      || tool.specialist === specialist?.id
      || names.has(tool.name)
      || skills.has(tool.skill)
    ));
  }
}

export default SpecialistToolRegistry;
