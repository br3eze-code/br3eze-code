import { intro, outro, text, select, confirm, spinner, isCancel, cancel } from '@clack/prompts';
import { CONFIG_PATH, getConfig, saveConfig } from '../../adapters/persistence/config.js';

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
    .action(async (options) => {
      const config = getConfig();
      if (options.yes || !process.stdin.isTTY || !process.stdout.isTTY) {
        config.onboarding = { ...(config.onboarding || {}), completed: true, mode: 'non-interactive', completedAt: new Date().toISOString() };
        saveConfig(config);
        const result = { ok: true, configPath: CONFIG_PATH, mode: 'non-interactive', next: ['agentos ask "Check system status"', 'agentos gateway'] };
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
      const wait = spinner();
      wait.start('Saving your AgentOS profile');
      await new Promise(resolve => setTimeout(resolve, 120));
      wait.stop('Profile saved');
      outro(enableAsk ? 'Ready. Start the gateway, then use `agentos ask`.' : 'Ready. Start the gateway when you are ready.');
    });
}
