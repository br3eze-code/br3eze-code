import { logger } from '../../core/logger.js';

export default function registerOnboardCommand(program) {
  program
    .command('onboard')
    .description('Configure a domain adapter and channel for this AgentOS profile')
    .option('--domain <name>', 'Domain capability pack to configure')
    .action(async (options) => {
      logger.info('Onboarding is available through the configured domain capability packs.', { domain: options.domain || 'general' });
    });
}
