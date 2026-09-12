import path from 'node:path';
import loadAllDomains from './loadDomain.js';
import { ToolRegistry } from './tool-registry.js';
import SkillRegistry from './skills/SkillRegistry.js';
import { getModelPolicy } from './model-router.js';
import { logger } from './logger.js';

/**
 * Single bootstrap boundary for AgentOS capabilities.
 * Domains, skills and tools are loaded through one runtime boundary so every
 * channel can consume the same capability graph and model policy.
 */
export async function bootstrapAgentOS({ registry, skillRegistry, config = {}, skillsPath } = {}) {
  const tools = registry || new ToolRegistry({
    logger,
    workspace: config.workspace,
    skillsPath: skillsPath || path.join(process.cwd(), 'src/skills'),
  });
  const skills = skillRegistry || new SkillRegistry();
  const resolvedSkillsPath = skillsPath || tools.skillsPath || path.join(process.cwd(), 'src/skills');

  await loadAllDomains(config, tools);

  // Keep the two registries deliberately single-purpose: ToolRegistry owns
  // executable tool/schema discovery, while SkillRegistry owns skill manifests
  // and validation. Both are populated from the same source directory.
  await Promise.all([
    tools.loadSkills(),
    skills.loadFromDirectory(resolvedSkillsPath, config),
  ]);

  const manifest = tools.getManifest();
  return {
    registry: tools,
    skillRegistry: skills,
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
