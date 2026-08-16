import chalk from 'chalk';
import StarlinkAdapter from '../../services/starlink/starlink-adapter.mjs';

function context(options = {}) {
  return {
    identity: {
      userId: process.env.AGENTOS_USER_ID || process.env.USER || process.env.USERNAME || null,
      tenantId: options.tenant || process.env.AGENTOS_TENANT_ID || null,
      role: options.role || process.env.AGENTOS_ROLE || 'operator',
    },
    scope: {
      tenantId: options.tenant || process.env.AGENTOS_TENANT_ID || null,
      domain: 'starlink',
      siteId: options.site || process.env.AGENTOS_SITE_ID || null,
    },
    location: options.location === true ? { permission: 'coarse' } : { permission: 'denied' },
  };
}

function requireReadContext(options) {
  const ctx = context(options);
  if (!ctx.identity.userId) throw new Error('Authenticated identity is required; set AGENTOS_USER_ID.');
  return ctx;
}

function requireMutationContext(options) {
  const ctx = requireReadContext(options);
  if (!ctx.identity.tenantId || !ctx.scope.siteId) {
    throw new Error('Tenant and site scope are required for Starlink mutations.');
  }
  if (options.approve !== true) {
    throw new Error('Mutation requires explicit approval. Re-run with --approve.');
  }
  return ctx;
}

function adapter() {
  return new StarlinkAdapter({
    clientId: process.env.STARLINK_CLIENT_ID,
    clientSecret: process.env.STARLINK_CLIENT_SECRET,
    baseUrl: process.env.STARLINK_API_BASE_URL,
  });
}

export default (program) => {
  const starlink = program.command('starlink').description('Inspect and operate scoped Starlink terminals');

  starlink.command('list')
    .description('List terminals visible to the current tenant/site scope')
    .option('--tenant <id>', 'Tenant scope')
    .option('--site <id>', 'Site scope')
    .option('--region <region>', 'Optional provider region filter')
    .option('--status <status>', 'Optional provider status filter')
    .option('--limit <n>', 'Maximum terminals', '100')
    .option('--location', 'Record coarse permission state in audit context')
    .action(async (options) => {
      const ctx = requireReadContext(options);
      const result = await adapter().listTerminals({ region: options.region, status: options.status, limit: Number(options.limit) });
      console.log(JSON.stringify({ context: ctx, terminals: result }, null, 2));
    });

  starlink.command('health <terminalId>')
    .description('Read terminal health')
    .option('--tenant <id>', 'Tenant scope')
    .option('--site <id>', 'Site scope')
    .action(async (terminalId, options) => {
      requireReadContext(options);
      console.log(JSON.stringify(await adapter().getTerminalHealth(terminalId), null, 2));
    });

  for (const [name, method] of [['reboot', 'rebootTerminal'], ['stow', 'stowTerminal']]) {
    starlink.command(`${name} <terminalId>`)
      .description(`${name === 'reboot' ? 'Reboot' : 'Stow'} a terminal with explicit approval`)
      .option('--tenant <id>', 'Tenant scope')
      .option('--site <id>', 'Site scope')
      .option('--approve', 'Approve the mutation')
      .action(async (terminalId, options) => {
        const ctx = requireMutationContext(options);
        const result = await adapter()[method](terminalId);
        console.log(chalk.green(`${name} requested for ${terminalId}`));
        console.log(JSON.stringify({ context: ctx, result }, null, 2));
      });
  }
};
