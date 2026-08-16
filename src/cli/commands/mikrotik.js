import chalk from 'chalk';
import { getManager } from '../../core/mikrotik.js';

function makeContext(options = {}) {
  const userId = process.env.AGENTOS_USER_ID || process.env.USER || process.env.USERNAME || null;
  const tenantId = options.tenant || process.env.AGENTOS_TENANT_ID || null;
  const siteId = options.site || process.env.AGENTOS_SITE_ID || null;
  if (!userId) throw new Error('Authenticated identity is required; set AGENTOS_USER_ID.');
  return {
    identity: { userId, tenantId, role: options.role || process.env.AGENTOS_ROLE || 'operator' },
    scope: { tenantId, domain: 'mikrotik', siteId },
  };
}

function mutationContext(options) {
  const ctx = makeContext(options);
  if (!ctx.identity.tenantId || !ctx.scope.siteId) throw new Error('Tenant and site scope are required for MikroTik mutations.');
  if (options.approve !== true) throw new Error('Mutation requires explicit approval. Re-run with --approve.');
  return ctx;
}

export default (program) => {
  const mikrotik = program.command('mikrotik').description('Inspect and operate scoped MikroTik routers');

  mikrotik.command('status')
    .description('Read router system statistics')
    .option('--tenant <id>', 'Tenant scope')
    .option('--site <id>', 'Site scope')
    .action(async (options) => {
      const ctx = makeContext(options);
      const manager = getManager();
      const result = await manager.executeTool('system.stats', {}, ctx);
      console.log(JSON.stringify({ context: ctx, result }, null, 2));
    });

  mikrotik.command('disconnect <name>')
    .description('Disconnect a hotspot user with explicit approval')
    .option('--tenant <id>', 'Tenant scope')
    .option('--site <id>', 'Site scope')
    .option('--approve', 'Approve the mutation')
    .action(async (name, options) => {
      const ctx = mutationContext(options);
      const manager = getManager();
      const result = await manager.executeTool('user.kick', { target: name }, ctx);
      console.log(chalk.green(`Disconnected ${name}`));
      console.log(JSON.stringify({ context: ctx, result }, null, 2));
    });
};
