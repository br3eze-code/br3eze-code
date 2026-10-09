/** Canonical errors shared by the AgentOS tool registry boundary. */
export class ToolNotFoundError extends Error {
  constructor(name) {
    super(`Tool not found: "${name}"`);
    this.name = 'ToolNotFoundError';
    this.toolName = name;
  }
}

export class SkillDisabledError extends Error {
  constructor(skillName, toolName = null) {
    super(`Skill disabled: "${skillName}"`);
    this.name = 'SkillDisabledError';
    this.skillName = skillName;
    this.toolName = toolName;
  }
}
