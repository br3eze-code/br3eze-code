import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function commandForPlatform(command) {
  return process.platform === 'win32' && command === 'pm2' ? 'pm2.cmd' : command;
}

async function run(command, args, options = {}) {
  const result = await execFileAsync(commandForPlatform(command), args, {
    cwd: options.cwd || process.cwd(),
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    ...options
  });
  return { stdout: result.stdout || '', stderr: result.stderr || '' };
}

function packageInstallCommand(cwd) {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return ['pnpm', ['install', '--prod', '--frozen-lockfile']];
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return ['yarn', ['install', '--production', '--frozen-lockfile']];
  if (fs.existsSync(path.join(cwd, 'package-lock.json'))) return ['npm', ['ci', '--omit=dev']];
  return ['npm', ['install', '--omit=dev']];
}

export default (program) => {
  program
    .command('update')
    .description('Safely update AgentOS from its Git repository')
    .option('--allow-dirty', 'Continue when tracked or untracked local changes exist')
    .option('--dry-run', 'Fetch and report available changes without modifying files')
    .option('--skip-install', 'Skip dependency installation after the fast-forward')
    .option('--restart', 'Restart the PM2 gateway after updating')
    .option('--json', 'Print machine-readable output')
    .action(async (options) => {
      const clack = await import('@clack/prompts');
      const chalk = (await import('chalk')).default;
      const output = (payload) => {
        if (options.json) console.log(JSON.stringify(payload));
      };
      const fail = (message, error = null) => {
        if (options.json) output({ ok: false, error: message });
        else clack.log.error(chalk.red(message));
        if (error && !options.json) clack.log.error(chalk.gray(error.message || String(error)));
        process.exitCode = 1;
      };

      const spinner = options.json ? null : clack.spinner();
      if (!options.json) clack.intro(chalk.cyan('AgentOS Update'));

      try {
        const { stdout: branchOutput } = await run('git', ['branch', '--show-current']);
        const branch = branchOutput.trim();
        if (!branch) throw new Error('Detached HEAD is not supported by the safe update workflow.');

        const { stdout: statusOutput } = await run('git', ['status', '--porcelain']);
        const dirty = Boolean(statusOutput.trim());
        if (dirty && !options.allowDirty) {
          throw new Error('Working tree has local changes. Commit or stash them, or rerun with --allow-dirty.');
        }

        if (spinner) spinner.start(`Fetching origin/${branch}…`);
        await run('git', ['fetch', '--prune', 'origin']);
        const { stdout: before } = await run('git', ['rev-parse', 'HEAD']);
        const { stdout: remote } = await run('git', ['rev-parse', `origin/${branch}`]);
        const changed = before.trim() !== remote.trim();

        if (options.dryRun) {
          if (spinner) spinner.stop(changed ? 'Updates are available.' : 'Already up to date.');
          output({ ok: true, dryRun: true, branch, dirty, updatesAvailable: changed, local: before.trim(), remote: remote.trim() });
          if (!options.json) clack.outro(changed ? chalk.yellow('Updates are available; no files were changed.') : chalk.green('Already up to date.'));
          return;
        }

        await run('git', ['pull', '--ff-only', 'origin', branch]);
        if (!options.skipInstall) {
          const [manager, args] = packageInstallCommand(process.cwd());
          if (spinner) spinner.message(`Installing dependencies with ${manager}…`);
          await run(manager, args);
        }

        if (options.restart) {
          if (spinner) spinner.message('Restarting gateway daemon…');
          await run('pm2', ['restart', 'agentos-gateway', '--update-env']);
          await run('pm2', ['save']);
        }

        const { stdout: after } = await run('git', ['rev-parse', 'HEAD']);
        if (spinner) spinner.stop('AgentOS updated successfully.');
        output({ ok: true, branch, dirty, changed: after.trim() !== before.trim(), commit: after.trim(), restarted: Boolean(options.restart) });
        if (!options.json) clack.outro(chalk.green('Update complete.'));
      } catch (error) {
        if (spinner) spinner.stop('Update failed.');
        fail('Update failed safely; no non-fast-forward merge was attempted.', error);
      }
    });
};
