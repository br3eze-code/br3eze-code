import { intro, outro, text, select, confirm, spinner, isCancel, cancel } from '@clack/prompts';
import { CONFIG_PATH, getConfig, saveConfig } from '../../adapters/persistence/config.js';
import { onboardRouter } from '../../adapters/network/onboard.js';

function cancelled(value) {
  if (isCancel(value)) {
    cancel('Onboarding cancelled.');
    return true;
  }
  return false;
}

function setNested(target, key, value) {
  const parts = key.split('.');
  let cursor = target;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] ||= {};
  cursor[parts.at(-1)] = value;
}

export default function registerOnboardCommand(program) {
  program
    .command('onboard')
    .description('Create or update an AgentOS profile with modern guided prompts')
    .option('--domain <name>', 'Domain capability pack to configure')
    .option('--yes', 'Create a safe non-interactive profile without prompts')
    .option('--json', 'Print the resulting profile as JSON')
    .option('--network-host <host>', 'MikroTik host for network onboarding')
    .option('--network-user <user>', 'MikroTik API user')
    .option('--network-password <password>', 'MikroTik API password')
    .option('--network-dry-run', 'Validate setup.rsc without applying it')
    .option('--agentos-ip <ip>', 'AgentOS gateway IP used by setup.rsc')
    .option('--agentos-api-password <password>', 'Generated RouterOS API password')
    .option('--agentos-admin-password <password>', 'Generated RouterOS admin password')
    .option('--agentos-operator-password <password>', 'Generated RouterOS operator password')
    .option('--agentos-readonly-password <password>', 'Generated RouterOS readonly password')
    .option('--firebase-url <url>', 'Firebase endpoint used by setup.rsc')
    .option('--firebase-api-key <key>', 'Firebase API key used by setup.rsc')
    .option('--backup-password <password>', 'Backup encryption password used by setup.rsc')
    .action(async (options) => {
      const config = getConfig();
      if (options.yes || !process.stdin.isTTY || !process.stdout.isTTY) {
        config.onboarding = { ...(config.onboarding || {}), completed: true, mode: 'non-interactive', completedAt: new Date().toISOString() };
        saveConfig(config);
        const result = { ok: true, configPath: CONFIG_PATH, mode: 'non-interactive', next: ['agentos login --provider google', 'agentos ask "Check system status"', 'agentos gateway'] };
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else console.log(`[AgentOS] Profile ready at ${CONFIG_PATH}. Run: agentos gateway`);
        return;
      }

      intro('AgentOS onboarding');
      const domain = options.domain || await select({ message: 'What should AgentOS prepare first?', options: [
        { value: 'general', label: 'General workspace', hint: 'safe defaults' },
        { value: 'network', label: 'Network operations', hint: 'MikroTik and gateway' },
        { value: 'commerce', label: 'Commerce and billing', hint: 'orders and payments' },
        { value: 'channels', label: 'Channels and notifications', hint: 'Telegram, WhatsApp, PWA' }
      ] });
      if (cancelled(domain)) return;
      const port = await text({ message: 'Gateway port', initialValue: String(config.gateway?.port || 19876), validate: value => Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) < 65536 ? undefined : 'Use a valid TCP port.' });
      if (cancelled(port)) return;
      const enableAsk = await confirm({ message: 'Enable the Ask Engine handoff?', initialValue: true });
      if (cancelled(enableAsk)) return;

      setNested(config, 'gateway.port', Number(port));
      config.onboarding = { completed: true, domain, askEngine: Boolean(enableAsk), completedAt: new Date().toISOString() };
      saveConfig(config);
      let network = null;
      if (domain === 'network' && options.networkHost) {
        network = await onboardRouter({
          host: options.networkHost,
          user: options.networkUser || config.network?.user,
          password: options.networkPassword || config.network?.password,
          dryRun: options.networkDryRun,
          apply: !options.networkDryRun,
          AGENTOS_IP: options.agentosIp || process.env.AGENTOS_IP,
          AGENTOS_API_PASSWORD: options.agentosApiPassword || process.env.AGENTOS_API_PASSWORD,
          AGENTOS_ADMIN_PASSWORD: options.agentosAdminPassword || process.env.AGENTOS_ADMIN_PASSWORD,
          AGENTOS_OPERATOR_PASSWORD: options.agentosOperatorPassword || process.env.AGENTOS_OPERATOR_PASSWORD,
          AGENTOS_READONLY_PASSWORD: options.agentosReadonlyPassword || process.env.AGENTOS_READONLY_PASSWORD,
          FIREBASE_URL: options.firebaseUrl || process.env.FIREBASE_URL,
          FIREBASE_API_KEY: options.firebaseApiKey || process.env.FIREBASE_API_KEY,
          BACKUP_PASSWORD: options.backupPassword || process.env.BACKUP_PASSWORD,
          tenantId: config.tenantId,
          siteId: config.siteId,
          name: config.name || 'site'
        });
        if (!network.success) throw new Error(network.error || 'Network onboarding failed');
      }
      const wait = spinner();
      wait.start('Saving your AgentOS profile');
      await new Promise(resolve => setTimeout(resolve, 120));
      wait.stop('Profile saved');
      outro(enableAsk ? 'Profile saved. Continue with `agentos login --provider google`, then start the gateway and use `agentos ask`.' : 'Profile saved. Continue with `agentos login --provider google`, then start the gateway when you are ready.');
    });
}
