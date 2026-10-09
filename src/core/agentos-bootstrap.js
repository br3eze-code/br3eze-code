import path from 'node:path';
import loadAllDomains from './loadDomain.js';
import { ToolRegistry } from './tool-registry.js';
import SkillRegistry from './skills/SkillRegistry.js';
import { getTaskRegistry } from './taskRegistry.js';
import { getModelPolicy } from './model-router.js';
import { logger } from './logger.js';

/**
 * Single bootstrap boundary for AgentOS capabilities.
 * Domains, skills, tools and tasks share one runtime boundary. Domain-specific
 * implementations are injected into the kernel; the kernel does not select
 * or import business adapters itself.
 */
export async function bootstrapAgentOS({ registry, skillRegistry, taskRegistry, config = {}, skillsPath } = {}) {
  const tasks = taskRegistry || getTaskRegistry();
  const tools = registry || new ToolRegistry({
    logger,
    workspace: config.workspace,
    skillsPath: skillsPath || path.join(process.cwd(), 'src/skills'),
    taskRegistry: tasks,
    requireExecutionTask: true,
  });
  // Existing registries supplied by callers are upgraded to the same task gate.
  tools.taskRegistry = tasks;
  tools.requireExecutionTask = true;

  const skills = skillRegistry || new SkillRegistry({ taskRegistry: tasks });
  skills.taskRegistry = tasks;
  const resolvedSkillsPath = skillsPath || tools.skillsPath || path.join(process.cwd(), 'src/skills');

  await loadAllDomains(config, tools);
  await Promise.all([
    tools.loadSkills(),
    skills.loadFromDirectory(resolvedSkillsPath, config),
  ]);

  const manifest = tools.getManifest();
  return {
    registry: tools,
    skillRegistry: skills,
    taskRegistry: tasks,
    manifest,
    modelPolicy: getModelPolicy(),
    counts: {
      domains: manifest.domains.length,
      skills: Math.max(manifest.skills.length, skills.count()),
      tools: manifest.tools.length,
    },
  };
}

export default bootstrapAgentOS;
