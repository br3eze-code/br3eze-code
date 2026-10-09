import path from 'node:path';
import SkillRegistry from './SkillRegistry.js';
import ToolPolicy from './specialists/ToolPolicy.js';
import ToolExecutor from './specialists/ToolExecutor.js';

/**
 * Unified skill toolbox. All executable skill tools cross the same policy and
 * execution boundary, while SkillRegistry remains responsible for lifecycle.
 */
class AgentToolbox {
  constructor(config = {}, registry = null, { policy = null, executor = null } = {}) {
    this.config = config;
    this.registry = registry || new SkillRegistry(config);
    this.policy = policy || new ToolPolicy();
    this.executor = executor || new ToolExecutor({ policy: this.policy });
    this.loaded = false;
  }

  async importSkills(skillsPath = this.config.skillsPath, names = null) {
    const root = path.resolve(skillsPath || path.resolve(process.cwd(), 'src/skills'));
    if (!names || names.length === 0) await this.registry.loadFromDirectory(root);
    else for (const name of names) await this.registry.loadSkill(path.join(root, name));
    this.loaded = true;
    return this.list();
  }

  initialize(skillsPath = this.config.skillsPath, names = null) { return this.importSkills(skillsPath, names); }
  list() { return this.registry.list(); }
  has(name) { return this.registry.has(name); }
  get(name) { return this.registry.get(name); }
  tools() { return this.registry.getAllToolDefinitions(); }
  describe() { return this.registry.getDescriptions(); }

  async execute(toolName, params = {}, context = {}) {
    if (!toolName || typeof toolName !== 'string') throw new TypeError('AgentToolbox.execute requires a tool name');

    const separator = toolName.indexOf('.');
    const skillName = separator > 0 ? toolName.slice(0, separator) : toolName;
    const definition = this.registry.getAllToolDefinitions().find((tool) => tool.name === toolName || tool.name === skillName);
    const skill = this.registry.get(skillName);
    if (!skill) throw new Error(`Skill not found: ${skillName}`);

    const manifestTool = (skill.manifest.tools || []).find((tool) =>
      tool.name === toolName || tool.name === toolName.slice(separator + 1)
    ) || {};

    const tool = {
      name: toolName,
      description: definition?.description || manifestTool.description || skill.manifest.description || '',
      parameters: definition?.parameters || manifestTool.parameters || skill.manifest.parameters || { type: 'object', properties: {} },
      inputSchema: manifestTool.inputSchema || manifestTool.parameters || definition?.parameters || skill.manifest.parameters || { type: 'object', properties: {} },
      outputSchema: manifestTool.outputSchema || null,
      specialist: manifestTool.specialist || skill.manifest.specialist || null,
      permissions: manifestTool.permissions || skill.manifest.permissions || [],
      ticketTypes: manifestTool.ticketTypes || skill.manifest.ticketTypes || [],
      risk: manifestTool.risk || 'low',
      skill: skillName,
      handler: async (args, executionContext) => this.registry.executeTool(toolName, args, executionContext),
    };

    const specialist = context.specialist || {
      id: context.agentId || context.agentRole || tool.specialist || 'runtime',
      role: context.agentRole || context.role || tool.specialist || 'runtime',
      ticketTypes: context.ticketTypes || [],
    };

    return this.executor.execute({
      specialist,
      tool,
      args: params,
      context,
      ticketType: context.ticketType || null,
      correlationId: context.correlationId || context.interactionId || null,
      taskId: context.taskId || context.ticketId || null,
    });
  }

  async destroy() {
    await this.registry.destroy();
    this.loaded = false;
  }
}

export default AgentToolbox;
export { AgentToolbox };
