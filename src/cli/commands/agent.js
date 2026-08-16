import chalk from 'chalk';
import path from 'node:path';
import SkillRegistry from '../../core/SkillRegistry.js';

function executionContext(options = {}) {
  const userId = process.env.AGENTOS_USER_ID || process.env.USER || process.env.USERNAME || null;
  if (!userId) throw new Error('Authenticated identity is required; set AGENTOS_USER_ID.');
  return {
    identity: {
      userId,
      tenantId: options.tenant || process.env.AGENTOS_TENANT_ID || null,
      role: options.role || process.env.AGENTOS_ROLE || 'operator',
    },
    scope: {
      tenantId: options.tenant || process.env.AGENTOS_TENANT_ID || null,
      domain: options.domain || process.env.AGENTOS_DOMAIN || 'general',
      siteId: options.site || process.env.AGENTOS_SITE_ID || null,
    },
    location: { permission: options.location === true ? 'coarse' : 'denied' },
  };
}

export default (program) => {
  const agent = program.command('agent').description('Inspect and operate the scoped AgentOS runtime');

  agent.command('context')
    .description('Show the current identity, tenant, site, domain, and location permission state')
    .option('--tenant <id>', 'Tenant scope')
    .option('--site <id>', 'Site scope')
    .option('--domain <name>', 'Domain scope')
    .option('--role <role>', 'Role used for policy evaluation')
    .option('--location', 'Request coarse location permission state')
    .action((options) => {
      console.log(JSON.stringify(executionContext(options), null, 2));
    });

  agent.command('run <skillName>')
    .description('Run a registered skill with explicit scoped context')
    .option('--param <key=value>', 'Skill parameter; may be repeated', (value, previous = {}) => {
      const separator = value.indexOf('=');
      if (separator < 1) throw new Error('Parameters must use key=value format.');
      return { ...previous, [value.slice(0, separator)]: value.slice(separator + 1) };
    }, {})
    .option('--tenant <id>', 'Tenant scope')
    .option('--site <id>', 'Site scope')
    .option('--domain <name>', 'Domain scope')
    .option('--role <role>', 'Role used for policy evaluation')
    .action(async (skillName, options) => {
      const context = executionContext(options);
      const registry = new SkillRegistry({});
      await registry.loadFromDirectory(path.join(process.cwd(), 'src', 'skills'));
      if (!registry.has(skillName)) throw new Error(`Skill not found: ${skillName}`);
      const skill = registry.get(skillName);
      const result = await skill.execute(options.param, { skill, context });
      console.log(chalk.green(`Skill ${skillName} completed`));
      console.log(JSON.stringify({ context, result }, null, 2));
    });
};
