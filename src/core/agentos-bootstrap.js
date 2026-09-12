import loadAllDomains from './loadDomain.js';
import { ToolRegistry } from './tool-registry.js';
import SkillRegistry from './skills/SkillRegistry.js';
import { getModelPolicy } from './model-router.js';
import { logger } from './logger.js';

/**
 * Single bootstrap boundary for AgentOS capabilities.
 * Domains, skills and tools are loaded once and exposed through one runtime
 * capability graph. Channel adapters should call this instead of maintaining
 * their own registries.
 */
export async function bootstrapAgentOS({ registry, skillRegistry, config = {}, skillsPath } = {}) {
  const tools = registry || new ToolRegistry({ logger, workspace: config.workspace });
  const skills = skillRegistry || new SkillRegistry();

  await loadAllDomains(config);
  if (skillsPath) await skills.loadFromDirectory(skillsPath, config);
  else await tools.loadSkills();

  const manifest = tools.getManifest();
  return {
    registry: tools,
    skillRegistry: skills,
    manifest,
    modelPolicy: getModelPolicy(),
    counts: {
      domains: manifest.domains.length,
      skills: manifest.skills.length,
      tools: manifest.tools.length,
    },
  };
}

export default bootstrapAgentOS;
