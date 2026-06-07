'use strict';

const chalk = require('chalk');
const { intro, outro, note, spinner } = require('@clack/prompts');
const tailscale = require('../../core/tailscale');

module.exports = (program) => {
  program
    .command('tailscale')
    .description('Manage or view Tailscale VPN status')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const s = spinner();
      
      if (!options.json) {
        intro(chalk.bgCyan.black.bold(' 🌐 Tailscale Connectivity '));
      }

      s.start('Fetching status...');
      const basic = await tailscale.getStatus();
      
      if (!basic.installed) {
        s.stop(chalk.red('✗ Tailscale not installed'));
        if (options.json) {
            console.log(JSON.stringify({ status: 'not_installed' }));
        } else {
            note('Tailscale binary was not found in your PATH.\nVisit https://tailscale.com/download to install it.', 'Help');
            outro(chalk.red('Binary missing'));
        }
        return;
      }

      const detailed = await tailscale.getDetailedStatus();
      const serviceRunning = await tailscale.isServiceRunning();

      s.stop(chalk.green('✓ Status retrieved'));

      if (options.json) {
        console.log(JSON.stringify({
            version: basic.version,
            serviceRunning,
            ...detailed
        }, null, 2));
        return;
      }

      const statusColor = detailed.online ? chalk.green : chalk.yellow;
      const report = [
        `${chalk.bold('Status:')}     ${statusColor(detailed.online ? 'Online' : 'Offline')}`,
        `${chalk.bold('Version:')}    ${basic.version}`,
        `${chalk.bold('Service:')}    ${serviceRunning ? chalk.green('Running') : chalk.red('Stopped')}`,
        `${chalk.bold('Tail-IP:')}    ${chalk.cyan(detailed.ip || 'None')}`,
        `${chalk.bold('User:')}       ${detailed.user || 'None'}`,
        `${chalk.bold('Device:')}     ${detailed.device || 'None'}`
      ].join('\n');

      note(report, 'Tailscale Report');

      if (!detailed.online) {
        note('Try running: ' + chalk.cyan('tailscale up'), 'Troubleshooting');
      }

      outro(chalk.bgCyan.black.bold(' Scan Complete '));
    });
};
