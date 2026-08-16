import { intro, outro, spinner, note, log } from '@clack/prompts';
import { execFileSync, execSync } from 'child_process';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { getConfig } from '../../core/config.js';
import { getDatabase } from '../../core/database.js';
import AgentToolbox from '../../core/agent-toolbox.js';
import { getAgentRoleProfile } from '../../core/agent-role-profiles.js';
import { instantiateWorkPackages } from '../../core/wbs-work-packages.js';

const SPECIALIST_ROLES = ['planner', 'engineer', 'accountant', 'secretary', 'procurement', 'expeditor', 'designer', 'draftsman'];

function runFastLintRepair({ fix = false } = {}) {
  const eslintBin = path.resolve(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'eslint.cmd' : 'eslint');
  const configuredTargets = process.env.AGENTOS_DOCTOR_LINT_PATHS
    ? process.env.AGENTOS_DOCTOR_LINT_PATHS.split(',').map((target) => target.trim()).filter(Boolean)
    : [
      'src/cli/commands/doctor.js',
      'src/core/agent-toolbox.js',
      'src/core/agent-role-profiles.js',
      'src/core/wbs-work-packages.js',
      'src/core/contractor-work-queue.js'
    ];
  const targets = configuredTargets.length > 0 ? configuredTargets : ['src/cli/commands/doctor.js'];
  const args = [...targets, '--quiet'];
  if (fix) args.push('--fix');
  try {
    const output = execFileSync(eslintBin, args, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 'ok', details: fix ? 'Fast lint repair completed' : 'Fast lint passed', output: output.trim() };
  } catch (error) {
    return {
      status: 'error',
      details: fix ? 'Fast lint repair incomplete' : 'Fast lint failed',
      output: `${error.stdout || ''}${error.stderr || ''}`.trim(),
      exitCode: error.status ?? 1
    };
  }
}

async function inspectSpecialistAgents({ config, context = {} }) {
  const results = [];
  const toolbox = new AgentToolbox(config);
  try {
    await toolbox.initialize(config.skillsPath);
    const tools = toolbox.tools();
    const descriptions = toolbox.describe();
    for (const role of SPECIALIST_ROLES) {
      const profile = getAgentRoleProfile(role);
      let workPackages = [];
      try {
        workPackages = instantiateWorkPackages(role, {
          tenantId: context.tenantId || 'doctor-scope',
          userId: context.userId || 'doctor',
          projectId: context.projectId || 'doctor-project',
          siteId: context.siteId || null,
          domain: context.domain || 'general'
        });
      } catch (error) {
        results.push({ name: `Agent:${role}`, status: 'error', details: `WBS invalid: ${error.message}` });
        continue;
      }
      const availableTools = tools.filter((tool) => !tool.role || tool.role === role || tool.role === '*');
      results.push({
        name: `Agent:${role}`,
        status: profile && workPackages.length > 0 ? 'ok' : 'error',
        details: profile && workPackages.length > 0
          ? `${profile.label}; ${workPackages.length} WBS packages; ${availableTools.length || descriptions.length} toolbox definitions`
          : 'Missing role profile or WBS packages'
      });
    }
  } catch (error) {
    for (const role of SPECIALIST_ROLES) {
      results.push({ name: `Agent:${role}`, status: 'error', details: `Toolbox unavailable: ${error.message}` });
    }
  } finally {
    try { await toolbox.destroy(); } catch (_) { /* cleanup is best effort */ }
  }
  return results;
}


export default (program) => {
  program
    .command('doctor')
    .description('Health checks and quick fixes')
    .option('--fix', 'Auto-repair issues')
    .option('--deep', 'Deep system scan')
    .action(async (options) => {
      const { BRAND, CONFIG_PATH, STATE_PATH } = global.AGENTOS;

      intro(chalk.bgBlue.black.bold(` 🔧 ${BRAND.name} Health Check `));

      const checks = [];
      const s = spinner();

      // Check 1: Configuration
      s.start('Checking configuration...');
      let config = {};
      if (fs.existsSync(CONFIG_PATH)) {
        try {
          config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
          s.stop(chalk.green('✓ Configuration valid'));
          checks.push({ name: 'Config', status: 'ok', details: `v${config.version || 'unknown'}` });
        } catch (e) {
          s.stop(chalk.red('✗ Configuration corrupted'));
          checks.push({ name: 'Config', status: 'error', details: e.message });
        }
      } else {
        s.stop(chalk.red('✗ No configuration found'));
        checks.push({ name: 'Config', status: 'error', details: 'Run agentos onboard' });
      }

      // Load config using the core module if available, to merge env variables, etc.
      try {
        config = getConfig();
      } catch (e) {
        // Fallback to the raw JSON config
      }

      // Check 2: MikroTik Connection
      s.start('Testing MikroTik connection...');
      try {
        const { testMikroTikConnection } = await import('../../core/mikrotik.js');
        const config = getConfig();

        const mkConfig = config.mikrotik || (config.adapters && config.adapters.mikrotik) || {};

        if (!mkConfig.host && !mkConfig.ip) {
          throw new Error('MikroTik config missing');
        }

        const result = await testMikroTikConnection(mkConfig);
        if (!result.success) throw new Error(result.message || 'Connection failed');

        let details = mkConfig.host || mkConfig.ip;
        if (result.details) {
            const { model, version, identity } = result.details;
            details = `${identity || 'MikroTik'} (${model || 'Unknown'} v${version || '?'}) @ ${details}`;
        }

        s.stop(chalk.green('✓ MikroTik connected'));
        checks.push({ name: 'MikroTik', status: 'ok', details });
      } catch (e) {
        s.stop(chalk.red(`✗ MikroTik error: ${e.message}`));
        checks.push({ name: 'MikroTik', status: 'error', details: e.message });
      }

      // Check 3: Firebase Connectivity
      s.start('Checking Firebase connectivity...');
      try {

        const db = await getDatabase();
        if (db.db) {
          const statsPromise = db.getStats();
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout connecting to Firebase')), 5000));
          await Promise.race([statsPromise, timeoutPromise]);
          s.stop(chalk.green('✓ Firebase Firestore connected'));
          checks.push({ name: 'Firebase', status: 'ok', details: 'Cloud mode active' });
        } else {
          s.stop(chalk.yellow('⚠ Firebase using local fallback'));
          checks.push({ name: 'Firebase', status: 'warn', details: 'Local mode active' });
        }
      } catch (e) {
        s.stop(chalk.red(`✗ Firebase error: ${e.message}`));
        checks.push({ name: 'Firebase', status: 'error', details: e.message });
      }

      // Check 4: Logs Daemon (UDP 5001)
      s.start('Checking Logs Daemon...');
      const checkLogsDaemon = () => new Promise((resolve) => {
        try {
          const isWin = process.platform === 'win32';
          // Use netstat to check if port 5001 is being listened on
          const cmd = isWin ? 'netstat -ano | findstr :5001' : 'lsof -i :5001';

          // Use a try-catch for execSync in case the command itself fails or returns non-zero (grep failure)
          let out = '';
          try {
            out = execSync(cmd, { stdio: 'pipe' }).toString();
          } catch (e) {
            // If findstr/grep finds nothing, it might exit with code 1
          }

          if (out.includes('5001') && (out.includes('LISTENING') || out.includes('UDP'))) {
            resolve({ status: 'ok', details: 'Active on port 5001' });
          } else {
            resolve({ status: 'warn', details: 'Daemon not detected' });
          }
        } catch (e) {
          resolve({ status: 'warn', details: 'Detection failed' });
        }
      });

      const logsStatus = await checkLogsDaemon();
      if (logsStatus.status === 'ok') {
        s.stop(chalk.green('✓ Logs Daemon active'));
      } else {
        s.stop(chalk.yellow('⚠ Logs Daemon inactive'));
      }
      checks.push({ name: 'Logs Daemon', ...logsStatus });

      // Check 5: Gateway Status
      s.start('Checking gateway process...');
      const pidFile = path.join(STATE_PATH, 'gateway.pid');
      if (fs.existsSync(pidFile)) {
        try {
          const pid = fs.readFileSync(pidFile, 'utf8');
          process.kill(parseInt(pid), 0);
          s.stop(chalk.green(`✓ Gateway running (PID: ${pid})`));
          checks.push({ name: 'Gateway', status: 'ok', details: `PID ${pid}` });
        } catch (e) {
          s.stop(chalk.yellow('⚠ Gateway not running (stale PID)'));
          checks.push({ name: 'Gateway', status: 'warn', details: 'Stale process' });
          if (options.fix) {
            try { fs.unlinkSync(pidFile); } catch (_) { /* stale-file cleanup is best effort */ }
            log.info(chalk.gray('Cleaned up stale PID file'));
          }
        }
      } else {
        s.stop(chalk.yellow('⚠ Gateway not running'));
        checks.push({ name: 'Gateway', status: 'warn', details: 'Inactive' });
      }

      // Check 5.5: Printer Status
      s.start('Checking Thermal Printer...');
      try {
        const { testPrinterConnection } = await import('../../core/printer.js');
        const printerConfig = config.printer || {};
        if (printerConfig.enabled !== false) {
           const result = await testPrinterConnection(printerConfig);
           if (result.success) {
               const statusMsg = result.message === 'Connected' ? `(${result.port})` : `(${result.port} — ${result.message})`;
               s.stop(chalk.green(`✓ Printer ${result.message === 'Connected' ? 'connected' : 'active'} ${statusMsg}`));
               checks.push({ name: 'Printer', status: 'ok', details: `${result.port}${result.message !== 'Connected' ? ' — ' + result.message : ''}` });
           } else if (result.portDiscovered) {
               // COM port was found via BT/USB but device is off or out of range — warn, not error
               const portId = result.port.replace(/^serial:[\\\\]+\\.[\\\\/]/, ''); // strip serial:\\.\\ prefix → COM4
               s.stop(chalk.yellow(`⚠ Printer port found (${portId}) but not responding — power it on`));
               checks.push({ name: 'Printer', status: 'warn', details: `${portId} — device offline` });
           } else {
               s.stop(chalk.yellow(`⚠ Printer: ${result.message}`));
               checks.push({ name: 'Printer', status: 'warn', details: result.message });
           }
        } else {
           s.stop(chalk.gray('○ Printer disabled'));
           checks.push({ name: 'Printer', status: 'ok', details: 'Disabled' });
        }
      } catch (e) {
        s.stop(chalk.red(`✗ Printer error: ${e.message}`));
        checks.push({ name: 'Printer', status: 'error', details: e.message });
      }

      // Check 6: AI Engine
      s.start('Checking AI Engine...');
      try {
        const { default: LLMCoordinator } = await import('../../core/llm/LLMCoordinator.js');
        const aiProvider = config.ai?.provider || 'none';
        const coordinator = new LLMCoordinator(aiProvider, config);

        if (aiProvider !== 'none' && config.ai?.key) {
          const provider = coordinator.createProvider(aiProvider, {
            apiKey: config.ai.key,
            model: config.ai.model
          });

          if (provider) {
            // Using a simple ping/validation if available, or just checking init
            await provider.initialize();

            // Try a lightweight validation if the provider supports it
            if (typeof provider.validateKey === 'function') {
              const r = await provider.validateKey();
              if (r.valid) {
                s.stop(chalk.green(`✓ AI Engine online (${aiProvider})`));
                checks.push({ name: 'AI Engine', status: 'ok', details: aiProvider });
              } else {
                const isRateLimit = r.error && (r.error.includes('429') || r.error.toLowerCase().includes('too many requests') || r.error.toLowerCase().includes('quota'));
                if (isRateLimit) {
                  s.stop(chalk.yellow(`⚠ AI Rate Limited: ${r.error}`));
                  checks.push({ name: 'AI Engine', status: 'warn', details: 'Rate Limited' });
                } else {
                  throw new Error(r.error);
                }
              }
            } else {
              s.stop(chalk.green(`✓ AI Engine initialized (${aiProvider})`));
              checks.push({ name: 'AI Engine', status: 'ok', details: aiProvider });
            }
          } else {
            throw new Error(`Provider ${aiProvider} could not be created`);
          }
        } else {
          s.stop(chalk.yellow('⚠ AI Engine disabled'));
          checks.push({ name: 'AI Engine', status: 'warn', details: 'No API key' });
        }
      } catch (e) {
        s.stop(chalk.red(`✗ AI error: ${e.message}`));
        checks.push({ name: 'AI Engine', status: 'error', details: e.message });
      }

      // Check 6.5: Tailscale VPN
      s.start('Checking Tailscale VPN...');
      try {
        const tailscale = await import('../../core/tailscale.js');
        const tsBasic = await tailscale.getStatus();
        if (tsBasic.installed) {
          const tsDetailed = await tailscale.getDetailedStatus();
          if (tsDetailed.online) {
            s.stop(chalk.green(`✓ Tailscale connected (${tsDetailed.ip})`));
            checks.push({ name: 'Tailscale', status: 'ok', details: tsDetailed.ip });
          } else {
            s.stop(chalk.yellow('⚠ Tailscale offline'));
            checks.push({ name: 'Tailscale', status: 'warn', details: 'Offline' });
          }
        } else {
          s.stop(chalk.gray('○ Tailscale not installed'));
          checks.push({ name: 'Tailscale', status: 'ok', details: 'Not Installed' });
        }
      } catch (e) {
        s.stop(chalk.gray('○ Tailscale check skipped'));
      }

      // Check 7-N: Messaging Channels
      const { BaseChannel } = await import('../../core/channels/BaseChannel.js');
      const channelsPath = path.join(process.cwd(), 'src', 'core', 'channels');
      const channelFiles = fs.readdirSync(channelsPath);
      for (const file of channelFiles) {
        if (file.endsWith('Channel.js') && file !== 'BaseChannel.js') {
          try { await import(pathToFileURL(path.join(channelsPath, file)).href); } catch (_) { /* unavailable channel adapters are skipped */ }
        }
      }

      const registeredAdapters = BaseChannel.getRegisteredTypes();

      for (const type of registeredAdapters) {
        const ChannelClass = BaseChannel.getAdapter(type);
        const meta = ChannelClass.getMetadata();
        const chanName = meta.name || type.charAt(0).toUpperCase() + type.slice(1);
        s.start(`Checking ${chanName} channel...`);

        const chanConfig = config[type] || (config.channels && config.channels.find(c => c.type === type)?.config);

        if (chanConfig?.enabled || (config.channels && config.channels.find(c => c.type === type))) {
          let status = 'ok';
          let details = 'Configured';

          // Use Channel's own validation if available
          try {
            const instance = new ChannelClass(chanConfig, { config: config });
            const v = await instance.validateConfig();
            if (!v.valid) {
              status = 'error';
              details = v.error;
            }
          } catch (e) {
            // Fallback to hardcoded legacy checks for un-refactored channels
            if (type === 'whatsapp') {
              const waAuthDir = chanConfig.authStateFolder || './data/whatsapp_auth';
              if (!fs.existsSync(waAuthDir)) {
                status = 'warn';
                details = 'Missing auth data';
              }
            } else if (type === 'slack') {
              if (!chanConfig.token || !chanConfig.appToken) {
                status = 'error';
                details = 'Missing Token/AppToken';
              }
            } else if (type === 'discord' || type === 'telegram') {
              if (!chanConfig.token) {
                status = 'error';
                details = 'Missing Token';
              }
            }
          }

          if (status === 'ok') s.stop(chalk.green(`✓ ${chanName} configured`));
          else if (status === 'warn') s.stop(chalk.yellow(`⚠ ${chanName}: ${details}`));
          else s.stop(chalk.red(`✗ ${chanName}: ${details}`));

          checks.push({ name: chanName, status, details });
        } else {
          s.stop(chalk.gray(`○ ${chanName} channel disabled`));
          if (['whatsapp', 'slack', 'discord', 'telegram'].includes(type)) {
            checks.push({ name: chanName, status: 'ok', details: 'Disabled' });
          }
        }
      }

      // Check 8: Specialist agent toolbox and WBS readiness
      s.start('Checking specialist agent toolbox...');
      const specialistChecks = await inspectSpecialistAgents({ config });
      const failedSpecialists = specialistChecks.filter((check) => check.status === 'error');
      s.stop(failedSpecialists.length === 0
        ? chalk.green(`✓ ${SPECIALIST_ROLES.length} specialist agents ready`)
        : chalk.red(`✗ ${failedSpecialists.length} specialist agents need repair`));
      checks.push(...specialistChecks);

      // Check 9: Fast ESLint repair/check
      s.start(options.fix ? 'Running fast ESLint repair...' : 'Running fast ESLint check...');
      const lintResult = runFastLintRepair({ fix: Boolean(options.fix) });
      if (lintResult.status === 'ok') {
        s.stop(chalk.green(`✓ ${lintResult.details}`));
      } else {
        s.stop(chalk.red(`✗ ${lintResult.details}`));
      }
      checks.push({ name: 'Fast ESLint', status: lintResult.status, details: lintResult.details, output: lintResult.output });

      // Summary
      const errors = checks.filter(c => c.status === 'error').length;
      const warnings = checks.filter(c => c.status === 'warn').length;

      const summaryLines = checks.map(check => {
        const icon = check.status === 'ok' ? chalk.green('●') :
          check.status === 'warn' ? chalk.yellow('▲') : chalk.red('■');
        return `${icon} ${chalk.bold(check.name.padEnd(15))} ${chalk.gray(check.details || '')}`;
      });

      note(summaryLines.join('\n'), chalk.bold.white('📋 Health Report'));
      const specialistSummary = specialistChecks.reduce((summary, check) => {
        summary[check.status] = (summary[check.status] || 0) + 1;
        return summary;
      }, {});
      note(`Specialists: ${specialistSummary.ok || 0} ready, ${specialistSummary.warn || 0} warnings, ${specialistSummary.error || 0} failed`, chalk.bold.white('🤖 Agent Report'));

      if (errors === 0 && warnings === 0) {
        outro(chalk.bgGreen.black.bold(' ✓ SYSTEM OPTIMAL '));
      } else if (errors === 0) {
        outro(chalk.bgYellow.black.bold(` ⚠ DEGRADED (${warnings} warnings) `));
      } else {
        outro(chalk.bgRed.white.bold(` ✗ CRITICAL (${errors} errors) `));
        if (!options.fix) {
          log.info(chalk.gray('Tip: Use "agentos doctor --fix" to attempt auto-repair.'));
        }
      }

      // Cleanup to prevent handle leaks causing Assertion failed in libuv (Windows)
      try {

        const db = await getDatabase();
        if (db) await db.close();
      } catch (_) { /* database cleanup is best effort */ }

      process.exit(errors > 0 ? 1 : 0);
    });
};
