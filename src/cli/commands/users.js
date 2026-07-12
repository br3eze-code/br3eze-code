'use strict';
/**
 * agentos users — manage both MikroTik hotspot users AND AgentOS platform users
 *
 * MikroTik subcommands (hotspot / network):
 *   list [-a] [-l N]   active sessions
 *   kick <name>        disconnect a user
 *   add <name>         create a hotspot user
 *   remove <name> [-f] delete a hotspot user
 *   status <name>      session stats
 *   transfer <name>    move between routers
 *
 * AgentOS platform subcommands:
 *   platform list              list all platform users from DB
 *   platform show <uid>        show a user's full profile + role
 *   platform role <uid> <role> assign a role (admin only)
 *   platform sandbox <uid>     toggle sandbox mode (admin only)
 *   platform delete <uid>      remove a platform user
 *   platform roles             list all available roles
 *   platform whoami            show currently authenticated operator's role
 */

const chalk = require('chalk');

export default (program) => {
  // ── MikroTik / Hotspot users ───────────────────────────────────────────
  const users = program
    .command('users')
    .description('Manage hotspot users (MikroTik) and AgentOS platform users');

  users
    .command('list')
    .description('List active hotspot sessions')
    .option('-a, --all', 'Show all users (not just active)')
    .option('-l, --limit <n>', 'Limit results', '20')
    .action(async (options) => {
      const { intro, outro, spinner, log } = await import('@clack/prompts');
      intro(chalk.cyan('👥  Hotspot Users'));
      const s = spinner();
      s.start('Fetching active sessions...');
      try {
        const { getManager } = require('../../core/mikrotik');
        const mikrotik = getManager();
        const users = await mikrotik.executeTool(
          options.all ? 'mikrotik.hotspot.user.getAll' : 'users.active', {}, {}
        );
        s.stop(`Found ${users.length} user(s)`);
        if (!users.length) { log.warn('No active sessions'); outro(''); return; }
        const rows = users.slice(0, parseInt(options.limit));
        rows.forEach(u => {
          log.info(`${chalk.green(u.name || u['mac-address'] || u.id)} — IP: ${chalk.yellow(u.address || '—')} uptime: ${u.uptime || '—'}`);
        });
      } catch (e) {
        s.stop('Failed');
        log.error(e.message);
      }
      outro('');
    });

  users
    .command('kick <name>')
    .description('Kick / disconnect a hotspot user')
    .action(async (name) => {
      const { intro, outro, spinner, log } = await import('@clack/prompts');
      intro(chalk.red('🦵  Kick User'));
      const s = spinner();
      s.start(`Disconnecting ${name}...`);
      try {
        const { getManager } = require('../../core/mikrotik');
        const mikrotik = getManager();
        await mikrotik.executeTool('user.kick', { target: name }, {});
        s.stop('Disconnected');
        log.success(`${name} has been disconnected`);
      } catch (e) {
        s.stop('Failed');
        log.error(e.message);
      }
      outro('');
    });

  users
    .command('add <name>')
    .description('Add a MikroTik hotspot user')
    .option('--password <pw>', 'Password (auto-generated if omitted)')
    .option('--profile <profile>', 'User profile / plan', 'default')
    .action(async (name, options) => {
      const { intro, outro, spinner, log } = await import('@clack/prompts');
      intro(chalk.green('➕  Add Hotspot User'));
      const s = spinner();
      s.start(`Creating ${name}...`);
      try {
        const { getManager } = require('../../core/mikrotik');
        const mikrotik = getManager();
        const password = options.password || Math.random().toString(36).slice(2, 10);
        await mikrotik.executeTool('mikrotik.hotspot.user.add', { name, password, profile: options.profile }, {});
        s.stop('Created');
        log.success(`User ${chalk.bold(name)} created — password: ${chalk.yellow(password)}`);
      } catch (e) {
        s.stop('Failed');
        log.error(e.message);
      }
      outro('');
    });

  users
    .command('remove <name>')
    .description('Remove a hotspot user')
    .option('-f, --force', 'Force removal even if currently active')
    .action(async (name, options) => {
      const { intro, outro, confirm, spinner, log, isCancel } = await import('@clack/prompts');
      intro(chalk.red('🗑️  Remove Hotspot User'));
      if (!options.force) {
        const ok = await confirm({ message: `Remove ${chalk.bold(name)}? This cannot be undone.` });
        if (isCancel(ok) || !ok) { outro('Cancelled'); return; }
      }
      const s = spinner();
      s.start(`Removing ${name}...`);
      try {
        const { getManager } = require('../../core/mikrotik');
        const mikrotik = getManager();
        await mikrotik.executeTool('mikrotik.hotspot.user.remove', { name }, {});
        s.stop('Removed');
        log.success(`${name} has been removed`);
      } catch (e) {
        s.stop('Failed');
        log.error(e.message);
      }
      outro('');
    });

  users
    .command('status <name>')
    .description('Show session stats for a hotspot user')
    .action(async (name) => {
      const { intro, outro, spinner, note, log } = await import('@clack/prompts');
      intro(chalk.cyan('📊  User Status'));
      const s = spinner();
      s.start(`Fetching ${name}...`);
      try {
        const { getManager } = require('../../core/mikrotik');
        const mikrotik = getManager();
        const stats = await mikrotik.executeTool('system.stats', { user: name }, {});
        s.stop('Done');
        note(
          Object.entries(stats).map(([k, v]) => `${chalk.gray(k.padEnd(16))} ${chalk.white(v)}`).join('\n'),
          `Stats: ${name}`
        );
      } catch (e) {
        s.stop('Failed');
        log.error(e.message);
      }
      outro('');
    });

  users
    .command('transfer <name>')
    .description('Transfer a user to another router')
    .option('--to <routerId>', 'Target router ID')
    .action(async (name, options) => {
      const { intro, outro, text, spinner, log, isCancel } = await import('@clack/prompts');
      intro(chalk.yellow('🔀  Transfer User'));
      const routerId = options.to || await text({ message: 'Target router ID:' });
      if (isCancel(routerId)) { outro('Cancelled'); return; }
      const s = spinner();
      s.start(`Transferring ${name} → ${routerId}...`);
      try {
        const { getManager } = require('../../core/mikrotik');
        const mikrotik = getManager();
        await mikrotik.executeTool('mikrotik.user.transfer', { name, targetRouter: routerId }, {});
        s.stop('Transferred');
        log.success(`${name} transferred to ${routerId}`);
      } catch (e) {
        s.stop('Failed');
        log.error(e.message);
      }
      outro('');
    });

  // ── AgentOS Platform Users ─────────────────────────────────────────────
  const platform = users
    .command('platform')
    .description('Manage AgentOS platform users, roles, and sandbox');

  platform
    .command('list')
    .description('List all platform users from the AgentOS database')
    .option('--role <role>', 'Filter by role')
    .option('-l, --limit <n>', 'Max results', '50')
    .option('--json', 'Print as JSON')
    .action(async (options) => {
      const { intro, outro, spinner, log } = await import('@clack/prompts');
      if (!options.json) intro(chalk.cyan('👥  Platform Users'));
      const s = options.json ? null : spinner();
      if (s) s.start('Loading...');
      try {
        const { getUserSandbox } = require('../../core/userSandbox');
        const { getDatabase } = require('../../core/database');
        const db = await getDatabase().catch(() => null);
        const sandbox = getUserSandbox({ db });
        const userList = await sandbox.listUsers({ role: options.role, limit: parseInt(options.limit) });
        if (s) s.stop(`${userList.length} user(s)`);

        if (options.json) { console.log(JSON.stringify(userList, null, 2)); return; }

        if (!userList.length) { log.warn('No users found'); outro(''); return; }
        const { roles } = require('../../policies/roles.json');
        userList.forEach(u => {
          const roleLabel = roles[u.role]?.label || u.role || 'user';
          const sandboxFlag = roles[u.role]?.sandbox ? chalk.yellow(' [sandbox]') : '';
          log.info(`${chalk.bold(u.uid || u.email || '—')} ${chalk.gray(roleLabel)}${sandboxFlag} ${chalk.dim(u.lastSeen || u.createdAt || '')}`);
        });
      } catch (e) {
        if (s) s.stop('Failed');
        if (!options.json) console.error(chalk.red(e.message));
        else console.error(JSON.stringify({ error: e.message }));
      }
      if (!options.json) outro('');
    });

  platform
    .command('show <uid>')
    .description('Show full profile and role for a platform user')
    .action(async (uid) => {
      const { intro, outro, note, spinner, log } = await import('@clack/prompts');
      intro(chalk.cyan(`👤  User: ${uid}`));
      const s = spinner();
      s.start('Loading...');
      try {
        const { getUserSandbox } = require('../../core/userSandbox');
        const { getDatabase } = require('../../core/database');
        const db = await getDatabase().catch(() => null);
        const sandbox = getUserSandbox({ db });
        const user = await sandbox.getUser(uid);
        if (!user) { s.stop('Not found'); log.warn(`User ${uid} not found`); outro(''); return; }
        const role = await sandbox.getRole(uid);
        s.stop('Found');
        note(
          `UID:      ${chalk.white(user.uid || uid)}\n` +
          `Name:     ${chalk.white(user.fullname || user.username || '—')}\n` +
          `Email:    ${chalk.white(user.email || '—')}\n` +
          `Role:     ${chalk.yellow(role.label || user.role || 'user')}\n` +
          `Sandbox:  ${role.sandbox ? chalk.yellow('yes') : chalk.gray('no')}\n` +
          `Source:   ${chalk.dim(user._source || '—')}\n` +
          `Created:  ${chalk.dim(user.createdAt || '—')}\n` +
          `Last seen:${chalk.dim(user.lastSeen || '—')}\n` +
          `Tools:    ${chalk.dim((role.tools || []).join(', '))}`,
          'User Profile'
        );
      } catch (e) {
        s.stop('Failed');
        log.error(e.message);
      }
      outro('');
    });

  platform
    .command('role <uid> <role>')
    .description('Assign a role to a platform user (requires admin)')
    .action(async (uid, role) => {
      const { intro, outro, spinner, log } = await import('@clack/prompts');
      intro(chalk.yellow(`🔑  Set Role`));
      const s = spinner();
      s.start(`Setting ${uid} → ${role}...`);
      try {
        const { getUserSandbox } = require('../../core/userSandbox');
        const { getDatabase } = require('../../core/database');
        const db = await getDatabase().catch(() => null);
        const sandbox = getUserSandbox({ db });
        const operatorId = global.AGENTOS?.WHOAMI?.login || 'cli-operator';
        await sandbox.setRole(operatorId, uid, role);
        s.stop('Done');
        log.success(`${uid} is now ${chalk.bold(role)}`);
      } catch (e) {
        s.stop('Failed');
        log.error(e.message);
      }
      outro('');
    });

  platform
    .command('sandbox <uid>')
    .description('Enable developer sandbox mode for a user (no real mutations)')
    .action(async (uid) => {
      const { intro, outro, spinner, log } = await import('@clack/prompts');
      intro(chalk.magenta('🧪  Sandbox Mode'));
      const s = spinner();
      s.start(`Enabling sandbox for ${uid}...`);
      try {
        const { getUserSandbox } = require('../../core/userSandbox');
        const { getDatabase } = require('../../core/database');
        const db = await getDatabase().catch(() => null);
        const sandbox = getUserSandbox({ db });
        const operatorId = global.AGENTOS?.WHOAMI?.login || 'cli-operator';
        await sandbox.setRole(operatorId, uid, 'developer');
        s.stop('Done');
        log.success(`${uid} is now in sandbox mode — tool calls will be intercepted, not applied`);
      } catch (e) {
        s.stop('Failed');
        log.error(e.message);
      }
      outro('');
    });

  platform
    .command('delete <uid>')
    .description('Delete a platform user from the database')
    .option('-f, --force', 'Skip confirmation')
    .action(async (uid, options) => {
      const { intro, outro, confirm, spinner, log, isCancel } = await import('@clack/prompts');
      intro(chalk.red('🗑️  Delete Platform User'));
      if (!options.force) {
        const ok = await confirm({ message: `Permanently delete ${chalk.bold(uid)}?` });
        if (isCancel(ok) || !ok) { outro('Cancelled'); return; }
      }
      const s = spinner();
      s.start(`Deleting ${uid}...`);
      try {
        const { getDatabase } = require('../../core/database');
        const db = await getDatabase().catch(() => null);
        if (db && typeof db.deleteUser === 'function') {
          await db.deleteUser(uid);
          s.stop('Deleted');
          log.success(`${uid} has been removed from the platform`);
        } else {
          s.stop('Unavailable');
          log.warn('Database not connected — cannot delete user');
        }
      } catch (e) {
        s.stop('Failed');
        log.error(e.message);
      }
      outro('');
    });

  platform
    .command('roles')
    .description('List all available roles and their permissions')
    .option('--json', 'Print as JSON')
    .action(async (options) => {
      const { intro, outro, note } = await import('@clack/prompts');
      const { roles } = require('../../policies/roles.json');

      if (options.json) { console.log(JSON.stringify(roles, null, 2)); return; }

      intro(chalk.cyan('🎭  Available Roles'));
      for (const [id, role] of Object.entries(roles)) {
        const sandboxBadge = role.sandbox ? chalk.yellow(' [sandbox]') : '';
        const approvalBadge = role.requireApproval?.length ? chalk.red(' [some approval required]') : '';
        note(
          `Tools: ${chalk.dim((role.tools || []).join(', '))}\n` +
          `Approval required: ${chalk.dim((role.requireApproval || []).join(', ') || 'none')}`,
          `${chalk.bold(id)} — ${role.label}${sandboxBadge}${approvalBadge}`
        );
      }
      outro('');
    });

  platform
    .command('whoami')
    .description('Show the current CLI operator role and permissions')
    .action(async () => {
      const { intro, outro, note } = await import('@clack/prompts');
      const { readCredentials } = require('./login.js')._internal;
      intro(chalk.cyan('👤  CLI Operator Identity'));
      const creds = readCredentials();
      const login = creds?.login || 'anonymous';
      try {
        const { getUserSandbox } = require('../../core/userSandbox');
        const { getDatabase } = require('../../core/database');
        const db = await getDatabase().catch(() => null);
        const sandbox = getUserSandbox({ db });
        const role = await sandbox.getRole(login);
        note(
          `Login:   ${chalk.white(creds?.login || '— not logged in')}\n` +
          `Name:    ${chalk.white(creds?.name || '—')}\n` +
          `Role:    ${chalk.yellow(role.label || 'user')}\n` +
          `Sandbox: ${role.sandbox ? chalk.yellow('yes') : chalk.gray('no')}\n` +
          `Tools:   ${chalk.dim((role.tools || []).join(', '))}`,
          'Your Identity'
        );
      } catch (e) {
        console.error(chalk.red(e.message));
      }
      outro('');
    });
};
