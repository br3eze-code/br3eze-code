'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const inquirer = require('inquirer');

let _clack;
const intro = (...args) => _clack.intro(...args);
const outro = (...args) => _clack.outro(...args);
const note = (...args) => _clack.note(...args);
const spinner = (...args) => _clack.spinner(...args);
const cancel = (...args) => _clack.cancel(...args);
const isCancel = (...args) => _clack.isCancel(...args);
const log = {
  success: (...args) => _clack.log.success(...args),
  error: (...args) => _clack.log.error(...args),
  warn: (...args) => _clack.log.warn(...args),
  info: (...args) => _clack.log.info(...args),
};
const chalk = require('chalk');
const { onboardFleet, onboardRouter } = require('../../core/onboard');

/** clack doesn't have a good way to handle inquirer-style loops easily, so we use inquirer for data entry */
async function prompt(questions) {
  // Add a small prefix to differentiate inquirer from clack
  if (Array.isArray(questions)) {
    questions.forEach(q => {
      q.message = chalk.cyan('? ') + q.message;
    });
  } else if (typeof questions === 'object') {
    questions.message = chalk.cyan('? ') + questions.message;
  }
  return inquirer.prompt(questions);
}

// Domain catalogue  ─────────────────────────────────────────────────────────────
const DOMAIN_CATALOGUE = {
  mikrotik: {
    label: 'MikroTik Network Management (hotspot, vouchers, firewall)',
    requiresAdapter: true,
    adapterKey: 'mikrotik',
  },
  linux: {
    label: 'Linux Server Management (SSH, services, monitoring)',
    requiresAdapter: false,
  },
  cloud: {
    label: 'Cloud Infrastructure (AWS / GCP / Azure)',
    requiresAdapter: false,
  },
  iot: {
    label: 'IoT / Edge Device Management (MQTT, sensors)',
    requiresAdapter: false,
  },
  cctv: {
    label: 'CCTV & Camera Systems (Dahua, Amcrest, Hikvision)',
    requiresAdapter: true,
    adapterKey: 'cctv',
  },
  general: {
    label: 'General AI Assistant (no specific infrastructure)',
    requiresAdapter: false,
  },
  codegen: {
    label: 'Code Generation & AI Coding Assistant',
    requiresAdapter: false,
  },
  custom: {
    label: 'Custom / Skip (configure manually later)',
    requiresAdapter: false,
  },
};

// ── MikroTik adapter ────────────────────────────────────────────────────────────
async function collectMikroTikConfig(existing = {}) {
  const { testMikroTikConnection } = require('../../core/mikrotik');
  note(
    chalk.gray('Configure one or more RouterOS API endpoints.'),
    chalk.cyan('📡 MikroTik Routers')
  );

  const routers = {};
  let addMore = true,
    idx = 0,
    defaultRouterId = null;

  while (addMore) {
    idx++;
    const answers = await prompt([
      {
        type: 'input',
        name: 'routerId',
        message: `Router ID (e.g. hq-router, branch-${idx}):`,
        default: `router-${idx}`,
        validate: v =>
          /^[a-zA-Z0-9_-]+$/.test(v.trim()) ? true : 'Alphanumeric, dash, underscore only',
      },
      {
        type: 'input',
        name: 'ip',
        message: 'Router IP address:',
        default: existing.routers?.[`router-${idx}`]?.host || existing.host || '192.168.88.1',
        validate: v => (/^\d+\.\d+\.\d+\.\d+$/.test(v.trim()) ? true : 'Invalid IP'),
      },
      {
        type: 'input',
        name: 'user',
        message: 'API Username:',
        default: existing.routers?.[`router-${idx}`]?.user || existing.user || 'admin',
      },
      {
        type: 'password',
        name: 'pass',
        message: 'API Password:',
        validate: v => (v.length > 0 ? true : 'Password required'),
      },
      {
        type: 'number',
        name: 'port',
        message: 'API Port:',
        default: existing.routers?.[`router-${idx}`]?.port || existing.port || 8728,
      },
    ]);

    const s = spinner();
    s.start(`Testing connection to ${answers.routerId}…`);
    try {
      const r = await testMikroTikConnection({
        host: answers.ip.trim(),
        user: answers.user.trim(),
        password: answers.pass,
        port: answers.port,
      });
      if (!r.success) throw new Error(r.message);
      s.stop(`✓ ${answers.routerId} connected`);
    } catch (err) {
      s.stop(`— ${err.message}`);
      const { cont } = await prompt({
        type: 'confirm',
        name: 'cont',
        message: 'Continue anyway?',
        default: true,
      });
      if (!cont) {
        throw new Error('Setup cancelled by user');
      }
    }

    routers[answers.routerId] = {
      host: answers.ip.trim(),
      user: answers.user.trim(),
      password: answers.pass,
      port: answers.port,
    };
    if (!defaultRouterId) defaultRouterId = answers.routerId;

    const { more } = await prompt({
      type: 'confirm',
      name: 'more',
      message: 'Add another MikroTik router?',
      default: false,
    });
    addMore = more;
  }

  const r = routers[defaultRouterId];
  return { host: r.host, user: r.user, password: r.password, port: r.port, routers };
}

// ── CCTV adapter ────────────────────────────────────────────────────────────────
async function collectCCTVConfig() {
  note(chalk.gray('Add each camera or NVR device.'), chalk.blue('📹 CCTV / Cameras'));
  const devices = [];
  let addMore = true;

  while (addMore) {
    const answers = await prompt([
      {
        type: 'list',
        name: 'driver',
        message: 'Camera system:',
        choices: [
          { value: 'dahua', name: 'Dahua / Amcrest / Lorex' },
          { value: 'hikvision', name: 'Hikvision / EZVIZ / Annke' },
        ],
      },
      {
        type: 'input',
        name: 'deviceId',
        message: 'Device ID:',
        default: `cam${devices.length + 1}`,
        validate: v => (/^[a-zA-Z0-9_-]+$/.test(v) ? true : 'Invalid ID'),
      },
      {
        type: 'input',
        name: 'host',
        message: 'Device IP:',
        default: '192.168.1.108',
      },
      {
        type: 'number',
        name: 'port',
        message: 'HTTP Port:',
        default: 80,
      },
      {
        type: 'input',
        name: 'user',
        message: 'Username:',
        default: 'admin',
      },
      {
        type: 'password',
        name: 'pass',
        message: 'Password:',
        validate: v => (v.length > 0 ? true : 'Required'),
      },
    ]);

    devices.push({
      driver: answers.driver,
      deviceId: answers.deviceId,
      host: answers.host.trim(),
      port: answers.port,
      user: answers.user.trim(),
      password: answers.pass,
    });

    const { more } = await prompt({
      type: 'confirm',
      name: 'more',
      message: 'Add another device?',
      default: false,
    });
    addMore = more;
  }
  return devices;
}

// ── Firebase ────────────────────────────────────────────────────────────────────
async function collectFirebaseConfig(existing = {}) {
  note(
    chalk.gray('Connect AgentOS to Firebase for cloud sync and user data.'),
    chalk.yellow('🔥 Firebase')
  );
  const { configType } = await prompt({
    type: 'list',
    name: 'configType',
    message: 'Firebase config type:',
    choices: [
      { value: 'serviceAccount', name: 'Service Account JSON (recommended)' },
      { value: 'apiKey', name: 'API Key (limited features)' },
      { value: 'none', name: 'Skip for now' },
    ],
  });

  if (configType === 'none') return { enabled: false };

  if (configType === 'serviceAccount') {
    const answers = await prompt([
      {
        type: 'input',
        name: 'saKeyPath',
        message: 'Path to serviceAccountKey.json:',
        default: existing.serviceAccount || './serviceAccountKey.json',
        validate: v => (fs.existsSync(v) ? true : 'File not found'),
      },
      {
        type: 'input',
        name: 'dbUrl',
        message: 'Firebase Database URL:',
        default: existing.databaseURL || '',
        validate: v => (v.startsWith('http') ? true : 'Invalid URL'),
      },
    ]);

    let projectId = '';
    try {
      projectId =
        JSON.parse(fs.readFileSync(path.resolve(answers.saKeyPath), 'utf8')).project_id || '';
      if (projectId) log.success(`Project ID detected: ${projectId}`);
    } catch (_) {}

    if (!projectId) {
      const { pId } = await prompt({
        type: 'input',
        name: 'pId',
        message: 'Firebase Project ID:',
        validate: v => (v.length > 0 ? true : 'Required'),
      });
      projectId = pId;
    }
    return {
      enabled: true,
      type: 'serviceAccount',
      serviceAccount: answers.saKeyPath,
      databaseURL: answers.dbUrl,
      projectId,
    };
  }

  const apiAnswers = await prompt([
    {
      type: 'input',
      name: 'apiKey',
      message: 'Firebase API Key:',
      validate: v => (v.length > 0 ? true : 'Required'),
    },
    {
      type: 'input',
      name: 'projectId',
      message: 'Firebase Project ID:',
      validate: v => (v.length > 0 ? true : 'Required'),
    },
    {
      type: 'input',
      name: 'databaseURL',
      message: 'Firebase Database URL:',
      validate: v => (v.startsWith('http') ? true : 'Invalid URL'),
    },
  ]);
  return { ...apiAnswers, enabled: true, type: 'apiKey' };
}

// ── Hotspot plans ─────────────────────────────────────────────────────────────
async function collectHotspotPlans(existingPlans = []) {
  if (existingPlans && existingPlans.length > 0) {
    log.info(`Current plans: ${existingPlans.map(p => p.name).join(', ')}`);
    const { keep } = await prompt({
      type: 'confirm',
      name: 'keep',
      message: 'Keep existing plans?',
      default: true,
    });
    if (keep) return existingPlans;
  }

  note(
    chalk.gray('Define WiFi voucher tiers customers can purchase.'),
    chalk.green('📋 Hotspot Plans')
  );
  const plans = [];
  let addMore = true;

  while (addMore) {
    const answers = await prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Plan name (e.g. 1 Hour, 1 Day):',
        validate: v => (v.trim().length > 0 ? true : 'Required'),
      },
      {
        type: 'input',
        name: 'description',
        message: 'Short description:',
        default: 'Internet access plan',
      },
      { type: 'number', name: 'deviceLimit', message: 'Max devices per voucher:', default: 1 },
      {
        type: 'list',
        name: 'durationUnit',
        message: 'Duration unit:',
        choices: [
          { value: 'hours', name: 'Hours' },
          { value: 'days', name: 'Days' },
          { value: 'weeks', name: 'Weeks' },
          { value: 'months', name: 'Months' },
          { value: null, name: 'Unlimited' },
        ],
      },
      {
        type: 'number',
        name: 'durationValue',
        message: 'Duration value:',
        default: 1,
        when: a => a.durationUnit !== null,
      },
      { type: 'input', name: 'imageUrl', message: 'Image URL (optional):', default: '' },
      {
        type: 'input',
        name: 'mikrotikProfile',
        message: 'MikroTik profile ID:',
        default: a => a.name.toLowerCase().replace(/\s+/g, ''),
        validate: v => (/^[a-zA-Z0-9_-]+$/.test(v) ? true : 'Invalid ID'),
      },
      { type: 'number', name: 'price', message: 'Price (local currency):', default: 10 },
      { type: 'input', name: 'currency', message: 'Currency code:', default: 'KES' },
      {
        type: 'confirm',
        name: 'active',
        message: 'Active (available for purchase)?',
        default: true,
      },
    ]);

    plans.push({ ...answers, currency: answers.currency.toUpperCase() });
    const { more } = await prompt({
      type: 'confirm',
      name: 'more',
      message: 'Add another plan?',
      default: plans.length < 3,
    });
    addMore = more;
  }
  return plans;
}

// ── Payment config ────────────────────────────────────────────────────────────
async function collectPaymentConfig(existing = {}) {
  note(
    chalk.gray('Configure a payment gateway so customers can self-serve vouchers.'),
    chalk.magenta('💳 Payment Provider')
  );
  const { provider } = await prompt({
    type: 'list',
    name: 'provider',
    message: 'Payment provider:',
    choices: [
      { value: 'none', name: 'None (manual / cash)' },
      { value: 'pesapay', name: 'PesaPay (Africa — card, M-Pesa, EFT)' },
      { value: 'stripe', name: 'Stripe (global — card, bank)' },
      { value: 'mpesa', name: 'M-Pesa (Safaricom Daraja API)' },
      { value: 'mastercard', name: 'Mastercard / Peach Payments (ZA)' },
      { value: 'webhook', name: 'Manual webhook URL (custom)' },
    ],
    default: existing.provider || 'none',
  });

  if (provider === 'none') return { provider, configured: false };

  log.info('Tip: you can also set credentials in .env later.');
  const c = existing.credentials || {};
  let credentials = {};

  if (provider === 'pesapay') {
    credentials = await prompt([
      { type: 'password', name: 'apiKey', message: 'PesaPay API Key:' },
      { type: 'password', name: 'merchantId', message: 'Merchant ID:' },
      {
        type: 'input',
        name: 'baseUrl',
        message: 'Base URL:',
        default: c.baseUrl || 'https://www.pesapay.co.za',
      },
    ]);
  } else if (provider === 'stripe') {
    credentials = await prompt([
      { type: 'password', name: 'secretKey', message: 'Stripe Secret Key (sk_…):' },
      {
        type: 'input',
        name: 'webhookSecret',
        message: 'Webhook Secret (optional):',
        default: c.webhookSecret || '',
      },
      {
        type: 'input',
        name: 'successUrl',
        message: 'Success redirect URL:',
        default: c.successUrl || 'http://localhost:3000/success',
      },
      {
        type: 'input',
        name: 'cancelUrl',
        message: 'Cancel redirect URL:',
        default: c.cancelUrl || 'http://localhost:3000/cancel',
      },
    ]);
  } else if (provider === 'mpesa') {
    credentials = await prompt([
      {
        type: 'input',
        name: 'consumerKey',
        message: 'Daraja Consumer Key:',
        default: c.consumerKey || '',
      },
      { type: 'password', name: 'consumerSecret', message: 'Consumer Secret:' },
      {
        type: 'input',
        name: 'shortcode',
        message: 'Shortcode (Paybill/Till):',
        default: c.shortcode || '',
      },
      { type: 'password', name: 'passkey', message: 'Passkey:' },
      {
        type: 'list',
        name: 'env',
        message: 'Environment:',
        choices: ['sandbox', 'production'],
        default: c.env || 'sandbox',
      },
    ]);
  } else if (provider === 'mastercard') {
    credentials = await prompt([
      { type: 'password', name: 'apiKey', message: 'Peach Payments API Key:' },
      { type: 'input', name: 'entityId', message: 'Entity ID:', default: c.entityId || '' },
      {
        type: 'input',
        name: 'baseUrl',
        message: 'Base URL:',
        default: c.baseUrl || 'https://testsecure.peachpayments.com',
      },
    ]);
  } else if (provider === 'webhook') {
    credentials = await prompt([
      { type: 'input', name: 'callbackUrl', message: 'Webhook URL:', default: c.callbackUrl || '' },
      { type: 'password', name: 'webhookSecret', message: 'Webhook secret (optional):' },
    ]);
  }

  const { currency } = await prompt({
    type: 'input',
    name: 'currency',
    message: 'Default currency:',
    default:
      existing.currency || (provider === 'mpesa' ? 'KES' : provider === 'pesapay' ? 'ZAR' : 'USD'),
  });

  return { provider, currency: currency.trim().toUpperCase(), credentials, configured: true };
}

module.exports = program => {
  program
    .command('onboard')
    .description('Interactive domain-agnostic setup wizard')
    .option('--reset', 'Overwrite existing configuration')
    .action(async options => {
      _clack = await import('@clack/prompts');
      if (!global.AGENTOS) {
        console.error('onboard must be run via the agentos CLI, not directly.');
        process.exit(1);
      }
      const { BRAND, CONFIG_PATH } = global.AGENTOS;
      const { logger } = require('../../core/logger');

      // Silence ALL winston transports during onboarding to avoid log noise
      // (instanceof Console check is unreliable for wrapped/custom transports)
      logger.transports.forEach(t => {
        t.silent = true;
      });
      const restoreLogs = () =>
        logger.transports.forEach(t => {
          t.silent = false;
        });

      intro(chalk.bgCyan.black.bold(` 🚀 ${BRAND.name} Setup — v${BRAND.version} `));

      // ── Guard: existing config ─────────────────────────────────────────────
      let existingConfig = {};
      const configExists = fs.existsSync(CONFIG_PATH);

      if (configExists) {
        try {
          existingConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        } catch (e) {
          console.warn(chalk.yellow('! Could not parse existing config, starting fresh.'));
        }
      }

      if (configExists && !options.reset) {
        const { mode } = await prompt({
          type: 'list',
          name: 'mode',
          message: 'Configuration already exists. What would you like to do?',
          choices: [
            { value: 'update', name: 'Update existing values' },
            { value: 'reset', name: 'Overwrite completely (start fresh)' },
            { value: 'cancel', name: 'Cancel' },
          ],
        });
        if (mode === 'cancel') {
          outro('Nothing changed.');
          return;
        }
        if (mode === 'reset') existingConfig = {};
      }

      // ── Step 1: Domains ──────────────────────────────────────────────────
      note(
        chalk.gray('Select every domain this AgentOS node will manage.'),
        chalk.blue.bold('🌐 Step 1 — Domains')
      );
      const { selectedDomains } = await prompt({
        type: 'checkbox',
        name: 'selectedDomains',
        message: 'Domains:',
        choices: Object.entries(DOMAIN_CATALOGUE).map(([key, val]) => ({
          value: key,
          name: val.label,
          checked: (existingConfig.domains || []).includes(key),
        })),
        validate: v => (v.length > 0 ? true : 'Select at least one domain'),
      });

      // ── Step 2: Adapters ──────────────────────────────────────────────────
      const adapters = {};
      if (selectedDomains.includes('mikrotik'))
        adapters.mikrotik = await collectMikroTikConfig(existingConfig.adapters?.mikrotik);
      if (selectedDomains.includes('cctv')) {
        const devs = await collectCCTVConfig();
        adapters.cctv = { dahua_devices: {}, hikvision_devices: {} };
        for (const d of devs) {
          const target = d.driver === 'dahua' ? 'dahua_devices' : 'hikvision_devices';
          adapters.cctv[target][d.deviceId] = { ...d };
        }
      }

      // ── Step 3: Telegram ──────────────────────────────────────────────────
      note(
        chalk.gray('Optional: receive alerts and issue commands via Telegram.'),
        chalk.cyan.bold('🤖 Step 3 — Telegram')
      );
      const { wantsTelegram } = await prompt({
        type: 'confirm',
        name: 'wantsTelegram',
        message: 'Configure Telegram bot?',
        default: existingConfig.telegram?.enabled ?? selectedDomains.includes('mikrotik'),
      });
      let telegramConfig = { enabled: false, token: '', allowedChats: [] };
      if (wantsTelegram) {
        const telAnswers = await prompt([
          {
            type: 'input',
            name: 'token',
            message: 'Bot Token (from @BotFather):',
            default: existingConfig.telegram?.token || '',
            validate: v =>
              /^\d+:[A-Za-z0-9_-]{35,}$/.test(v.trim()) ? true : 'Invalid token format',
          },
          {
            type: 'input',
            name: 'chatsRaw',
            message: 'Allowed Chat IDs (comma-separated, blank = all):',
            default: (existingConfig.telegram?.allowedChats || []).join(', '),
          },
        ]);
        telegramConfig = {
          enabled: true,
          token: telAnswers.token.trim(),
          allowedChats: telAnswers.chatsRaw
            .split(',')
            .map(s => s.trim())
            .filter(Boolean),
        };
      }

      // ── Step 3.5: WhatsApp ───────────────────────────────────────────────
      note(
        chalk.gray('Optional: receive alerts and issue commands via WhatsApp.'),
        chalk.greenBright.bold('📱 Step 3.5 — WhatsApp')
      );
      const { wantsWhatsApp } = await prompt({
        type: 'confirm',
        name: 'wantsWhatsApp',
        message: 'Configure WhatsApp channel?',
        default: existingConfig.whatsapp?.enabled ?? selectedDomains.includes('mikrotik'),
      });
      let whatsappConfig = {
        enabled: false,
        authStateFolder: './data/whatsapp_auth',
        allowedJids: [],
      };
      if (wantsWhatsApp) {
        const waAnswers = await prompt([
          {
            type: 'input',
            name: 'authDir',
            message: 'Auth state folder:',
            default: existingConfig.whatsapp?.authStateFolder || './data/whatsapp_auth',
          },
          {
            type: 'input',
            name: 'jidsRaw',
            message: 'Allowed JIDs (comma-separated, blank = all):',
            default: (existingConfig.whatsapp?.allowedJids || []).join(', '),
          },
        ]);
        whatsappConfig = {
          enabled: true,
          authStateFolder: waAnswers.authDir.trim(),
          allowedJids: waAnswers.jidsRaw
            .split(',')
            .map(s => s.trim())
            .filter(Boolean),
        };
      }

      // ── Step 3.6: Slack ──────────────────────────────────────────────────
      note(
        chalk.gray('Optional: receive alerts and issue commands via Slack.'),
        chalk.cyanBright.bold('💬 Step 3.6 — Slack')
      );
      const { wantsSlack } = await prompt({
        type: 'confirm',
        name: 'wantsSlack',
        message: 'Configure Slack channel?',
        default: existingConfig.slack?.enabled || false,
      });
      let slackConfig = { enabled: false };
      if (wantsSlack) {
        const slackAnswers = await prompt([
          {
            type: 'password',
            name: 'token',
            message: 'Slack Bot Token (xoxb-...):',
            default: existingConfig.slack?.token,
          },
          {
            type: 'password',
            name: 'appToken',
            message: 'Slack App Token (xapp-...):',
            default: existingConfig.slack?.appToken,
          },
          {
            type: 'confirm',
            name: 'socketMode',
            message: 'Enable Socket Mode?',
            default: existingConfig.slack?.socketMode !== false,
          },
        ]);
        slackConfig = { enabled: true, ...slackAnswers };
      }

      // ── Step 3.7: Discord ────────────────────────────────────────────────
      note(
        chalk.gray('Optional: receive alerts and issue commands via Discord.'),
        chalk.blueBright.bold('🎮 Step 3.7 — Discord')
      );
      const { wantsDiscord } = await prompt({
        type: 'confirm',
        name: 'wantsDiscord',
        message: 'Configure Discord channel?',
        default: existingConfig.discord?.enabled || false,
      });
      let discordConfig = { enabled: false };
      if (wantsDiscord) {
        const { token } = await prompt({
          type: 'password',
          name: 'token',
          message: 'Discord Bot Token:',
          default: existingConfig.discord?.token,
        });
        discordConfig = { enabled: true, token };
      }

      // ── Step 3.8: SMS ────────────────────────────────────────────────────
      note(
        chalk.gray('Optional: send/receive messages via SMS.'),
        chalk.greenBright.bold('📱 Step 3.8 — SMS')
      );
      const { wantsSMS } = await prompt({
        type: 'confirm',
        name: 'wantsSMS',
        message: 'Configure SMS channel?',
        default: existingConfig.sms?.enabled || false,
      });
      let smsConfig = { enabled: false };
      if (wantsSMS) {
        const smsAnswers = await prompt([
          {
            type: 'list',
            name: 'provider',
            message: 'SMS Provider:',
            choices: ['twilio', 'econet'],
            default: existingConfig.sms?.provider || 'twilio',
          },
        ]);
        if (smsAnswers.provider === 'twilio') {
          const tAnswers = await prompt([
            {
              type: 'input',
              name: 'accountSid',
              message: 'Twilio Account SID:',
              default: existingConfig.sms?.accountSid,
            },
            {
              type: 'password',
              name: 'authToken',
              message: 'Twilio Auth Token:',
              default: existingConfig.sms?.authToken,
            },
            {
              type: 'input',
              name: 'fromNumber',
              message: 'Twilio From Number:',
              default: existingConfig.sms?.fromNumber,
            },
          ]);
          smsConfig = { enabled: true, provider: 'twilio', ...tAnswers };
        } else if (smsAnswers.provider === 'econet') {
          const eAnswers = await prompt([
            {
              type: 'input',
              name: 'clientId',
              message: 'Econet Client ID:',
              default: existingConfig.sms?.clientId,
            },
            {
              type: 'password',
              name: 'clientSecret',
              message: 'Econet Client Secret:',
              default: existingConfig.sms?.clientSecret,
            },
            {
              type: 'input',
              name: 'fromName',
              message: 'Econet From Name:',
              default: existingConfig.sms?.fromName || 'AgentOS',
            },
          ]);
          smsConfig = { enabled: true, provider: 'econet', ...eAnswers };
        }
      }

      // ── Step 3.9: USSD ───────────────────────────────────────────────────
      note(
        chalk.gray('Optional: manage services via USSD.'),
        chalk.yellowBright.bold('📶 Step 3.9 — USSD')
      );
      const { wantsUSSD } = await prompt({
        type: 'confirm',
        name: 'wantsUSSD',
        message: 'Configure USSD channel?',
        default: existingConfig.ussd?.enabled || false,
      });
      let ussdConfig = { enabled: false };
      if (wantsUSSD) {
        const ussdAnswers = await prompt([
          {
            type: 'input',
            name: 'apiKey',
            message: "Africa's Talking API Key:",
            default: existingConfig.ussd?.apiKey,
          },
          {
            type: 'input',
            name: 'username',
            message: "Africa's Talking Username:",
            default: existingConfig.ussd?.username,
          },
          {
            type: 'input',
            name: 'serviceCode',
            message: 'USSD Service Code (e.g. *384*123#):',
            default: existingConfig.ussd?.serviceCode,
          },
        ]);
        ussdConfig = { enabled: true, provider: 'africastalking', ...ussdAnswers };
      }

      // ── Step 3.10: Email ─────────────────────────────────────────────────
      note(
        chalk.gray('Optional: receive alerts and interact via Email.'),
        chalk.whiteBright.bold('📧 Step 3.10 — Email')
      );
      const { wantsEmail } = await prompt({
        type: 'confirm',
        name: 'wantsEmail',
        message: 'Configure Email channel?',
        default: existingConfig.email?.enabled || false,
      });
      let emailConfig = { enabled: false };
      if (wantsEmail) {
        const emailAnswers = await prompt([
          {
            type: 'input',
            name: 'host',
            message: 'SMTP Host (e.g. smtp.gmail.com):',
            default: existingConfig.email?.host,
          },
          {
            type: 'number',
            name: 'port',
            message: 'SMTP Port:',
            default: existingConfig.email?.port || 587,
          },
          {
            type: 'input',
            name: 'user',
            message: 'SMTP User (Email):',
            default: existingConfig.email?.user,
          },
          {
            type: 'password',
            name: 'pass',
            message: 'SMTP Password/App Password:',
            default: existingConfig.email?.pass,
          },
          {
            type: 'input',
            name: 'from',
            message: 'From Address (e.g. AgentOS <bot@domain.com>):',
            default: existingConfig.email?.from,
          },
        ]);
        emailConfig = { enabled: true, ...emailAnswers };
      }

      // ── Step 4: AI Provider ───────────────────────────────────────────────
      note(
        chalk.gray('Pick the AI brain powering your agents.'),
        chalk.magentaBright.bold('🧠 Step 4 — AI Provider')
      );
      // Load all providers via LLMCoordinator to ensure they are registered
      const { BaseProvider } = require('../../core/llm/providers/BaseProvider');
      const LLMCoordinator = require('../../core/llm/LLMCoordinator');
      try {
        new LLMCoordinator('gemini');
      } catch (_) {
        /* just registering provider classes, key isn't needed yet */
      }

      const registry = BaseProvider.getRegistry();

      // ── 4a: Company / provider family ─────────────────────────────────────
      const COMPANY_CHOICES = [
        { value: 'google', name: '🔵  Google         — Gemini 3.x / Gemma open models' },
        { value: 'openai', name: '🟢  OpenAI         — GPT-5.4 · GPT-4o · o3/o4' },
        { value: 'anthropic', name: '🟠  Anthropic       — Claude Opus/Sonnet/Haiku' },
        { value: 'meta', name: '🔷  Meta            — Llama 4 / Llama 3.x' },
        { value: 'deepseek', name: '🟣  DeepSeek        — V4 Pro/Flash · R1 reasoning' },
        { value: 'groq', name: '⚡  Groq            — Ultra-fast inference platform' },
        { value: 'together', name: '🌐  Together AI     — 100+ open models' },
        { value: 'openrouter', name: '🔀  OpenRouter      — 400+ models · 70+ providers' },
        { value: 'xai', name: '🌑  xAI             — Grok 4.x' },
        { value: 'moonshot', name: '🌙  Moonshot / Kimi — long context · K2' },
        { value: 'minimax', name: '🎯  MiniMax         — MiniMax-Text-01 · abab6.5' },
        { value: 'local', name: '🏠  Local (Ollama)  — runs on your hardware' },
        { value: 'none', name: '⚙️   None / custom   — set manually later' },
      ];

      const { aiCompany } = await prompt({
        type: 'list',
        name: 'aiCompany',
        message: 'AI company / provider family:',
        choices: COMPANY_CHOICES,
        default: (() => {
          const p = existingConfig.ai?.provider || 'gemini';
          const map = {
            gemini: 'google',
            gemma: 'google',
            openai: 'openai',
            anthropic: 'anthropic',
            llama: 'meta',
            deepseek: 'deepseek',
            groq: 'groq',
            together: 'together',
            openrouter: 'openrouter',
            xai: 'xai',
            moonshot: 'moonshot',
            minimax: 'minimax',
            ollama: 'local',
          };
          return map[p] || 'google';
        })(),
      });

      // ── 4b: Model selection — latest first → [LEGACY] → [DEPRECATED] ─────
      // ★ = recommended/flagship  ⚡ = fast/cheap  🧠 = reasoning/CoT
      // [LEGACY] = accessible but superseded  [DEPRECATED] = retiring/hard-EOL
      const MODEL_MAP = {
        // ── Google (Gemini API / Vertex AI) ──────────────────────────────────
        google: [
          {
            value: 'gemini-3.5-flash',
            name: '★  gemini-3.5-flash               — latest Flash (May 2026)',
          },
          {
            value: 'gemini-3.1-pro',
            name: '   gemini-3.1-pro                 — strongest reasoning',
          },
          { value: 'gemini-3-pro', name: '   gemini-3-pro                   — stable flagship' },
          {
            value: 'gemini-3.1-flash-lite',
            name: '⚡  gemini-3.1-flash-lite           — cheapest / high-volume',
          },
          { value: 'gemini-2.5-pro', name: '   gemini-2.5-pro                 [LEGACY] paid tier' },
          {
            value: 'gemini-2.5-flash',
            name: '   gemini-2.5-flash               [LEGACY] paid tier',
          },
          {
            value: 'gemini-2.5-flash-preview-05-20',
            name: '   gemini-2.5-flash-preview-05-20 [LEGACY] pinned',
          },
          {
            value: 'gemini-2.5-pro-preview-06-05',
            name: '   gemini-2.5-pro-preview-06-05   [LEGACY] pinned',
          },
          {
            value: 'gemini-2.0-flash',
            name: '   gemini-2.0-flash               [DEPRECATED] shut down Jun 2026',
          },
          {
            value: 'gemini-2.0-flash-lite',
            name: '   gemini-2.0-flash-lite          [DEPRECATED] shut down Jun 2026',
          },
          {
            value: 'gemini-1.5-pro',
            name: '   gemini-1.5-pro                 [DEPRECATED] retiring',
          },
          {
            value: 'gemini-1.5-flash',
            name: '   gemini-1.5-flash               [DEPRECATED] retiring',
          },
          { value: 'gemma-3-27b-it', name: '   gemma-3-27b-it                 — Gemma 3 open 27B' },
          { value: 'gemma-3-12b-it', name: '   gemma-3-12b-it                 — Gemma 3 open 12B' },
          { value: 'gemma-3-4b-it', name: '⚡  gemma-3-4b-it                  — Gemma 3 edge 4B' },
          { value: 'gemma2-9b-it', name: '   gemma2-9b-it                   [LEGACY] Gemma 2 9B' },
        ],

        // ── OpenAI ───────────────────────────────────────────────────────────
        openai: [
          {
            value: 'gpt-5.4',
            name: '★  gpt-5.4                        — current standard (1M ctx)',
          },
          { value: 'gpt-5.4-pro', name: '   gpt-5.4-pro                    — max capability' },
          { value: 'gpt-5.4-mini', name: '⚡  gpt-5.4-mini                   — fast & affordable' },
          {
            value: 'gpt-5.4-nano',
            name: '⚡  gpt-5.4-nano                   — ultra-cheap / bulk',
          },
          {
            value: 'gpt-4o',
            name: '   gpt-4o                         [LEGACY] retired from ChatGPT',
          },
          { value: 'gpt-4o-mini', name: '   gpt-4o-mini                    [LEGACY]' },
          { value: 'gpt-4.1', name: '   gpt-4.1                        [DEPRECATED] retired' },
          { value: 'gpt-4.1-mini', name: '   gpt-4.1-mini                   [DEPRECATED] retired' },
          { value: 'gpt-4-turbo', name: '   gpt-4-turbo                    [DEPRECATED]' },
          {
            value: 'o3',
            name: '🧠  o3                              [DEPRECATED] retired from picker',
          },
          { value: 'o3-mini', name: '🧠  o3-mini                         [DEPRECATED]' },
          { value: 'o4-mini', name: '🧠  o4-mini                         [DEPRECATED]' },
          { value: 'o1', name: '🧠  o1                              [DEPRECATED]' },
          { value: 'o1-mini', name: '🧠  o1-mini                         [DEPRECATED]' },
          { value: 'gpt-4', name: '   gpt-4                          [DEPRECATED] hard EOL' },
          {
            value: 'gpt-3.5-turbo',
            name: '   gpt-3.5-turbo                  [DEPRECATED] hard EOL',
          },
        ],

        // ── Anthropic ────────────────────────────────────────────────────────
        anthropic: [
          {
            value: 'claude-opus-4-8',
            name: '★  claude-opus-4-8                — latest Opus (Jun 2026)',
          },
          {
            value: 'claude-sonnet-4-6',
            name: '★  claude-sonnet-4-6              — workhorse / 90% of tasks',
          },
          { value: 'claude-haiku-4-5', name: '⚡  claude-haiku-4-5               — fast & cheap' },
          { value: 'claude-opus-4-5', name: '   claude-opus-4-5               [LEGACY]' },
          { value: 'claude-sonnet-4-5', name: '   claude-sonnet-4-5             [LEGACY]' },
          {
            value: 'claude-3-7-sonnet-20250219',
            name: '   claude-3-7-sonnet-20250219    [LEGACY]',
          },
          {
            value: 'claude-3-5-sonnet-20241022',
            name: '   claude-3-5-sonnet-20241022    [LEGACY] Claude 3.5',
          },
          { value: 'claude-3-5-haiku-20241022', name: '   claude-3-5-haiku-20241022     [LEGACY]' },
          {
            value: 'claude-3-opus-20240229',
            name: '   claude-3-opus-20240229        [DEPRECATED]',
          },
          {
            value: 'claude-3-sonnet-20240229',
            name: '   claude-3-sonnet-20240229      [DEPRECATED]',
          },
          {
            value: 'claude-3-haiku-20240307',
            name: '   claude-3-haiku-20240307       [DEPRECATED]',
          },
          { value: 'claude-2.1', name: '   claude-2.1                    [DEPRECATED]' },
        ],

        // ── Meta Llama (hosted on Groq for speed or Together for variety) ────
        meta: [
          {
            value: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
            name: '★  Llama 4 Maverick 17B 128E FP8 (Together) — MoE flagship',
          },
          {
            value: 'meta-llama/Llama-4-Scout-17B-16E-Instruct',
            name: '   Llama 4 Scout 17B 16E (Together) — efficient MoE',
          },
          { value: 'llama-3.3-70b-versatile', name: '★  Llama 3.3 70B (Groq) — best open/fast' },
          { value: 'llama-3.1-8b-instant', name: '⚡  Llama 3.1 8B Instant (Groq) — ultra-fast' },
          { value: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: '   Llama 3.3 70B (Together)' },
          {
            value: 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo',
            name: '   Llama 3.1 405B (Together) — max quality',
          },
          {
            value: 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo',
            name: '   Llama 3.2 90B Vision (Together)',
          },
          {
            value: 'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo',
            name: '   Llama 3.2 11B Vision (Together) — light multimodal',
          },
          {
            value: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
            name: '   Llama 3.1 70B (Together)               [LEGACY]',
          },
          {
            value: 'llama-3.1-70b-versatile',
            name: '   Llama 3.1 70B (Groq)                   [LEGACY]',
          },
          {
            value: 'llama3-70b-8192',
            name: '   Llama 3 70B (Groq)                     [DEPRECATED]',
          },
          {
            value: 'llama3-8b-8192',
            name: '   Llama 3 8B (Groq)                      [DEPRECATED]',
          },
        ],

        // ── DeepSeek ─────────────────────────────────────────────────────────
        deepseek: [
          {
            value: 'deepseek-v4-pro',
            name: '★  deepseek-v4-pro                — 1.6T MoE · 1M ctx (Apr 2026)',
          },
          {
            value: 'deepseek-v4-flash',
            name: '⚡  deepseek-v4-flash              — 284B · cost-efficient',
          },
          {
            value: 'deepseek-v3',
            name: '   deepseek-v3                    [LEGACY] Dec 2024 flagship',
          },
          {
            value: 'deepseek-chat',
            name: '   deepseek-chat                  [DEPRECATED] alias retiring Jul 24 2026',
          },
          {
            value: 'deepseek-reasoner',
            name: '🧠  deepseek-reasoner              [DEPRECATED] alias retiring Jul 24 2026',
          },
          { value: 'deepseek-coder-v2', name: '   deepseek-coder-v2              [DEPRECATED]' },
          { value: 'deepseek-coder', name: '   deepseek-coder                 [DEPRECATED]' },
        ],

        // ── Groq (inference platform) ─────────────────────────────────────────
        groq: [
          {
            value: 'llama-3.3-70b-versatile',
            name: '★  llama-3.3-70b-versatile        — top reasoning + speed',
          },
          {
            value: 'llama-3.1-8b-instant',
            name: '⚡  llama-3.1-8b-instant           — ultra-fast · low cost',
          },
          {
            value: 'openai/gpt-oss-120b',
            name: '   openai/gpt-oss-120b            — OpenAI OSS 120B via Groq',
          },
          {
            value: 'openai/gpt-oss-20b',
            name: '⚡  openai/gpt-oss-20b             — OpenAI OSS 20B fast',
          },
          { value: 'gemma2-9b-it', name: '   gemma2-9b-it                   — Google Gemma 2 9B' },
          { value: 'mixtral-8x7b-32768', name: '   mixtral-8x7b-32768             — Mistral MoE' },
          {
            value: 'whisper-large-v3-turbo',
            name: '   whisper-large-v3-turbo         — fast speech-to-text',
          },
          {
            value: 'whisper-large-v3',
            name: '   whisper-large-v3               — accurate speech-to-text',
          },
          { value: 'llama-3.1-70b-versatile', name: '   llama-3.1-70b-versatile        [LEGACY]' },
          { value: 'llama3-70b-8192', name: '   llama3-70b-8192               [DEPRECATED]' },
          { value: 'llama3-8b-8192', name: '   llama3-8b-8192                [DEPRECATED]' },
        ],

        // ── Together AI (100+ open models) ───────────────────────────────────
        together: [
          {
            value: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
            name: '★  Llama 4 Maverick 17B 128E FP8   — MoE flagship',
          },
          {
            value: 'meta-llama/Llama-4-Scout-17B-16E-Instruct',
            name: '   Llama 4 Scout 17B 16E           — efficient MoE',
          },
          {
            value: 'Qwen/Qwen3.6-Plus',
            name: '★  Qwen 3.6 Plus                    — latest Qwen 2026',
          },
          {
            value: 'Qwen/Qwen3.5-397B-A17B',
            name: '   Qwen 3.5 397B A17B              — MoE massive',
          },
          { value: 'Qwen/Qwen3.5-9B', name: '⚡  Qwen 3.5 9B                      — fast & cheap' },
          {
            value: 'deepseek-ai/DeepSeek-V4-Pro',
            name: '   DeepSeek-V4-Pro               (via Together)',
          },
          {
            value: 'deepseek-ai/DeepSeek-R1',
            name: '🧠  DeepSeek-R1                    (via Together, reasoning)',
          },
          { value: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: '   Llama 3.3 70B Turbo' },
          {
            value: 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo',
            name: '   Llama 3.1 405B Turbo            — max quality',
          },
          {
            value: 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo',
            name: '   Llama 3.2 90B Vision            — multimodal',
          },
          {
            value: 'Qwen/Qwen2.5-72B-Instruct-Turbo',
            name: '   Qwen 2.5 72B Turbo             [LEGACY]',
          },
          { value: 'deepseek-ai/DeepSeek-V3', name: '   DeepSeek-V3                    [LEGACY]' },
          {
            value: 'mistralai/Mixtral-8x22B-Instruct-v0.1',
            name: '   Mixtral 8x22B                  [LEGACY]',
          },
          {
            value: 'mistralai/Mixtral-8x7B-Instruct-v0.1',
            name: '   Mixtral 8x7B                   [LEGACY]',
          },
        ],

        // ── OpenRouter (400+ models from 70+ providers, one API key) ─────────
        openrouter: [
          {
            value: 'anthropic/claude-opus-4-8',
            name: '★  Claude Opus 4.8 (Anthropic)    — latest flagship',
          },
          {
            value: 'anthropic/claude-sonnet-4-6',
            name: '★  Claude Sonnet 4.6 (Anthropic)  — workhorse',
          },
          {
            value: 'anthropic/claude-haiku-4-5',
            name: '⚡  Claude Haiku 4.5 (Anthropic)   — cheap',
          },
          { value: 'openai/gpt-5.4', name: '★  GPT-5.4 (OpenAI)               — latest standard' },
          {
            value: 'openai/gpt-5.4-pro',
            name: '   GPT-5.4 Pro (OpenAI)           — max capability',
          },
          { value: 'openai/gpt-5.4-mini', name: '⚡  GPT-5.4 Mini (OpenAI)          — fast' },
          {
            value: 'google/gemini-3.5-flash',
            name: '★  Gemini 3.5 Flash (Google)       — latest Flash',
          },
          { value: 'google/gemini-3.1-pro', name: '   Gemini 3.1 Pro (Google)' },
          { value: 'meta-llama/llama-4-maverick', name: '   Llama 4 Maverick (Meta)' },
          { value: 'deepseek/deepseek-v4-pro', name: '   DeepSeek V4 Pro (DeepSeek)' },
          { value: 'x-ai/grok-4-3', name: '   Grok 4.3 (xAI)' },
          {
            value: 'openrouter/auto',
            name: '⚡  openrouter/auto                 — auto-pick best model',
          },
          {
            value: 'openrouter/free',
            name: '⚡  openrouter/free                 — free tier router',
          },
          { value: 'openai/gpt-4o', name: '   GPT-4o (OpenAI)               [LEGACY]' },
          {
            value: 'anthropic/claude-3.5-sonnet',
            name: '   Claude 3.5 Sonnet              [LEGACY]',
          },
          { value: 'google/gemini-2.5-pro', name: '   Gemini 2.5 Pro                 [LEGACY]' },
          {
            value: 'google/gemini-2.0-flash-001',
            name: '   Gemini 2.0 Flash               [DEPRECATED]',
          },
        ],

        // ── xAI Grok ─────────────────────────────────────────────────────────
        xai: [
          {
            value: 'grok-4-3',
            name: '★  grok-4-3                       — current flagship (Jun 2026)',
          },
          {
            value: 'grok-4-3-latest',
            name: '   grok-4-3-latest                — always-latest 4.3 patch',
          },
          {
            value: 'grok-build-0.1',
            name: '   grok-build-0.1                — coding agent (fast)',
          },
          {
            value: 'grok-3',
            name: '   grok-3                         [DEPRECATED] redirects to 4.3',
          },
          {
            value: 'grok-3-mini',
            name: '   grok-3-mini                    [DEPRECATED] redirects to 4.3',
          },
          { value: 'grok-4-1', name: '   grok-4-1                       [DEPRECATED]' },
          { value: 'grok-2', name: '   grok-2                         [DEPRECATED]' },
          { value: 'grok-2-vision', name: '   grok-2-vision                  [DEPRECATED]' },
          { value: 'grok-beta', name: '   grok-beta                      [DEPRECATED]' },
        ],

        // ── Moonshot AI / Kimi ────────────────────────────────────────────────
        moonshot: [
          {
            value: 'kimi-k2-0711-preview',
            name: '★  kimi-k2-0711-preview           — Kimi K2 latest (2026)',
          },
          {
            value: 'kimi-k1.5-preview',
            name: '   kimi-k1.5-preview              — K1.5 extended reasoning',
          },
          { value: 'moonshot-v1-128k', name: '   moonshot-v1-128k               — 128K ctx' },
          { value: 'moonshot-v1-32k', name: '   moonshot-v1-32k                — 32K ctx' },
          {
            value: 'moonshot-v1-8k',
            name: '⚡  moonshot-v1-8k                 — 8K fast / standard',
          },
        ],

        // ── MiniMax ───────────────────────────────────────────────────────────
        minimax: [
          {
            value: 'MiniMax-Text-01',
            name: '★  MiniMax-Text-01                — flagship · 1M ctx',
          },
          { value: 'abab6.5g-chat', name: '   abab6.5g-chat                  — fine-tunable' },
          { value: 'abab6.5s-chat', name: '⚡  abab6.5s-chat                  — fast inference' },
          { value: 'abab5.5s-chat', name: '   abab5.5s-chat                  [LEGACY]' },
          { value: 'abab5.5-chat', name: '   abab5.5-chat                   [DEPRECATED]' },
        ],

        // ── Local / Ollama — latest-to-legacy, VRAM guidance ─────────────────
        // 8GB VRAM → 3–8B models  |  16GB → 14–32B  |  40GB+ → 70B+
        local: [
          {
            value: 'qwen3:32b',
            name: '★  qwen3:32b                      — top reasoning · 20GB VRAM',
          },
          { value: 'qwen3:14b', name: '   qwen3:14b                      — balanced · 10GB' },
          { value: 'qwen3:8b', name: '⚡  qwen3:8b                       — fast · 6GB' },
          { value: 'qwen3:4b', name: '⚡  qwen3:4b                       — edge · 4GB' },
          {
            value: 'llama3.3:70b',
            name: '   llama3.3:70b                   — Meta Llama 3.3 · 40GB+',
          },
          {
            value: 'llama3.2:11b',
            name: '   llama3.2:11b                   — vision capable · 8GB',
          },
          { value: 'llama3.2:3b', name: '⚡  llama3.2:3b                    — edge/mobile · 3GB' },
          { value: 'gemma4:12b', name: '   gemma4:12b                     — Gemma 4 12B · 8GB' },
          { value: 'gemma4:4b', name: '⚡  gemma4:4b                      — Gemma 4 edge · 4GB' },
          { value: 'phi4', name: '   phi4                           — MS Phi-4 14B · 10GB' },
          { value: 'phi4-mini', name: '⚡  phi4-mini                      — Phi-4 Mini · 4GB' },
          {
            value: 'mistral-small',
            name: '   mistral-small                  — Mistral Small 24B · 16GB',
          },
          {
            value: 'deepseek-r1:32b',
            name: '🧠  deepseek-r1:32b                — reasoning · 20GB',
          },
          {
            value: 'deepseek-r1:70b',
            name: '🧠  deepseek-r1:70b                — reasoning · 40GB+',
          },
          { value: 'deepseek-v3', name: '   deepseek-v3                    — DeepSeek V3' },
          { value: 'llama3:latest', name: '   llama3:latest                  [LEGACY] Llama 3 8B' },
          {
            value: 'mistral:latest',
            name: '   mistral:latest                 [LEGACY] Mistral 7B',
          },
          { value: 'gemma2:9b', name: '   gemma2:9b                      [LEGACY] Gemma 2 9B' },
          { value: 'gemma:7b', name: '   gemma:7b                       [DEPRECATED]' },
        ],
      };

      let aiProvider = 'none';
      let aiModel = '';

      if (aiCompany !== 'none') {
        const companyModels = MODEL_MAP[aiCompany] || [];

        let selectedModel;
        if (companyModels.length > 0) {
          const { modelChoice } = await prompt({
            type: 'list',
            name: 'modelChoice',
            message: 'Select model:',
            choices: [
              ...companyModels,
              { value: '__custom__', name: '✏️  Enter custom model name…' },
            ],
            default: existingConfig.ai?.model || companyModels[0]?.value,
          });
          if (modelChoice === '__custom__') {
            const { customModel } = await prompt({
              type: 'input',
              name: 'customModel',
              message: 'Model name:',
            });
            selectedModel = customModel.trim();
          } else {
            selectedModel = modelChoice;
          }
        } else {
          const { customModel } = await prompt({
            type: 'input',
            name: 'customModel',
            message: 'Model name:',
          });
          selectedModel = customModel.trim();
        }

        // Map company → internal provider key
        const COMPANY_TO_PROVIDER = {
          google: selectedModel.startsWith('gemma') ? 'gemma' : 'gemini',
          openai: 'openai',
          anthropic: 'anthropic',
          meta: 'llama',
          deepseek: 'deepseek',
          groq: 'groq',
          together: 'together',
          openrouter: 'openrouter',
          xai: 'xai',
          moonshot: 'moonshot',
          minimax: 'minimax',
          local: 'ollama',
        };
        aiProvider = COMPANY_TO_PROVIDER[aiCompany] || aiCompany;
        aiModel = selectedModel;
      }

      if (aiProvider !== 'none' && !registry[aiProvider]) {
        log.warn(
          `'${aiProvider}' isn't registered as an available provider — it may not work until that's fixed.`
        );
      }

      let aiKey = '';
      if (aiProvider !== 'none') {
        const keyName = {
          gemini: 'GEMINI_API_KEY',
          gemma: 'GEMINI_API_KEY',
          openai: 'OPENAI_API_KEY',
          anthropic: 'ANTHROPIC_API_KEY',
          llama: 'GROQ_API_KEY',
          together: 'TOGETHER_AI_API_KEY',
          deepseek: 'DEEPSEEK_API_KEY',
          groq: 'GROQ_API_KEY',
          openrouter: 'OPENROUTER_API_KEY',
          moonshot: 'MOONSHOT_API_KEY',
          minimax: 'MINIMAX_API_KEY',
          xai: 'XAI_API_KEY',
        }[aiProvider];
        const envKey = process.env[keyName];
        if (envKey) {
          log.success(`Using ${keyName} from environment`);
          aiKey = envKey;
        } else {
          const { key } = await prompt({
            type: 'password',
            name: 'key',
            message: `${aiProvider} API Key:`,
          });
          aiKey = key;
        }

        const s = spinner();
        s.start(`Validating ${aiProvider} key…`);
        try {
          let prov;
          if (aiProvider === 'anthropic') {
            const { AnthropicProvider } = require('../../core/llm/providers/AnthropicProvider');
            prov = new AnthropicProvider({ apiKey: aiKey });
          } else if (aiProvider === 'openai') {
            const { OpenAIProvider } = require('../../core/llm/providers/OpenAIProvider');
            prov = new OpenAIProvider({ apiKey: aiKey });
          } else if (aiProvider === 'gemini') {
            const { GeminiProvider } = require('../../core/llm/providers/GeminiProvider');
            prov = new GeminiProvider({ apiKey: aiKey });
          } else if (aiProvider === 'gemma') {
            const { GemmaProvider } = require('../../core/llm/providers/GemmaProvider');
            prov = new GemmaProvider({ apiKey: aiKey });
          } else if (aiProvider === 'llama') {
            const { LlamaProvider } = require('../../core/llm/providers/LlamaProvider');
            prov = new LlamaProvider({ apiKey: aiKey });
          } else if (aiProvider === 'together') {
            const { TogetherAIProvider } = require('../../core/llm/providers/TogetherAIProvider');
            prov = new TogetherAIProvider({ apiKey: aiKey });
          } else if (aiProvider === 'deepseek') {
            const { DeepSeekProvider } = require('../../core/llm/providers/DeepSeekProvider');
            prov = new DeepSeekProvider({ apiKey: aiKey });
          } else if (aiProvider === 'groq') {
            const { GroqProvider } = require('../../core/llm/providers/GroqProvider');
            prov = new GroqProvider({ apiKey: aiKey });
          } else if (aiProvider === 'openrouter') {
            const { OpenRouterProvider } = require('../../core/llm/providers/OpenRouterProvider');
            prov = new OpenRouterProvider({ apiKey: aiKey });
          } else if (aiProvider === 'moonshot') {
            const { MoonshotProvider } = require('../../core/llm/providers/MoonshotProvider');
            prov = new MoonshotProvider({ apiKey: aiKey });
          } else if (aiProvider === 'minimax') {
            const { MiniMaxProvider } = require('../../core/llm/providers/MiniMaxProvider');
            prov = new MiniMaxProvider({ apiKey: aiKey });
          } else if (aiProvider === 'xai') {
            const { XAIProvider } = require('../../core/llm/providers/XAIProvider');
            prov = new XAIProvider({ apiKey: aiKey });
          } else if (aiProvider === 'ollama') {
            const { OllamaProvider } = require('../../core/llm/providers/OllamaProvider');
            prov = new OllamaProvider({ apiKey: aiKey });
          }

          if (prov) {
            const r = await prov.validateKey();
            if (r.valid) s.stop(`✓ ${aiProvider} key valid`);
            else {
              s.stop(`— Validation failed: ${r.error}`);
              const { cont } = await prompt({
                type: 'confirm',
                name: 'cont',
                message: 'Continue anyway?',
                default: false,
              });
              if (!cont) {
                outro('Setup cancelled.');
                return;
              }
            }
          } else s.stop('Key stored (no validator)');
        } catch (e) {
          s.stop(`— ${e.message}`);
        }

        existingConfig.ai = { provider: aiProvider, apiKey: aiKey, model: aiModel };
      }

      // ── Step 5: Gateway ──────────────────────────────────────────────────
      note('Configure the AgentOS WebSocket gateway.', '🌐 Step 5 — Gateway');
      const gwAnswers = await prompt([
        {
          type: 'number',
          name: 'port',
          message: 'WebSocket port:',
          default: existingConfig.gateway?.port || 19876,
        },
        {
          type: 'confirm',
          name: 'autostart',
          message: 'Auto-start on boot (PM2)?',
          default: existingConfig.gateway?.autostart !== false,
        },
      ]);
      const gatewayConfig = { port: gwAnswers.port, autostart: gwAnswers.autostart };

      // ── Step 6: Payment & Plans ──────────────────────────────────────────
      const paymentConfig = await collectPaymentConfig(existingConfig.payments);
      const firebaseConfig = await collectFirebaseConfig(existingConfig.firebase);

      let plans = [];
      if (selectedDomains.includes('mikrotik')) {
        plans = await collectHotspotPlans(existingConfig.plans);
      }

      // ── Build final config ────────────────────────────────────────────────
      const config = {
        name: BRAND.name,
        version: BRAND.version,
        createdAt: new Date().toISOString(),
        domains: selectedDomains,
        adapters,
        telegram: telegramConfig,
        whatsapp: whatsappConfig,
        slack: slackConfig,
        discord: discordConfig,
        sms: smsConfig,
        ussd: ussdConfig,
        email: emailConfig,
        ai: { provider: aiProvider, apiKey: aiKey, model: aiModel },
        gateway: {
          ...gatewayConfig,
          host: '127.0.0.1',
          token:
            existingConfig.gateway?.token ||
            process.env.AGENTOS_GATEWAY_TOKEN ||
            crypto.randomBytes(32).toString('hex'),
        },
        firebase: firebaseConfig,
        payments: paymentConfig,
        plans,
        features: {
          vouchers: selectedDomains.includes('mikrotik'),
          telegramBot: wantsTelegram,
          whatsappBot: wantsWhatsApp,
          slackBot: wantsSlack,
          discordBot: wantsDiscord,
          smsBot: wantsSMS,
          ussdBot: wantsUSSD,
          emailBot: wantsEmail,
          webDashboard: true,
          payments: paymentConfig.provider !== 'none',
        },
      };

      // ── Summary Presentation (Clack) ──────────────────────────────────────
      note(
        `${chalk.gray(`Domains  : `) + chalk.cyan(selectedDomains.join(', '))}\n${chalk.gray(
          `AI       : `
        )}${chalk.magenta(aiProvider)}\n${chalk.gray(
          `Telegram : `
        )}${wantsTelegram ? chalk.green('enabled') : chalk.red('disabled')}\n${chalk.gray(
          `WhatsApp : `
        )}${wantsWhatsApp ? chalk.green('enabled') : chalk.red('disabled')}\n${chalk.gray(
          `Slack    : `
        )}${wantsSlack ? chalk.green('enabled') : chalk.red('disabled')}\n${chalk.gray(
          `Discord  : `
        )}${wantsDiscord ? chalk.green('enabled') : chalk.red('disabled')}\n${chalk.gray(
          `Gateway  : `
        )}${chalk.cyan(`ws://127.0.0.1:${gatewayConfig.port}`)}\n${chalk.gray(
          `Firebase : `
        )}${firebaseConfig.enabled ? chalk.green('connected') : chalk.red('disabled')}\n${chalk.gray(
          `Payments : `
        )}${chalk.yellow(paymentConfig.provider)}`,
        chalk.bold.green('📋 Configuration Summary')
      );

      const { confirmSave } = await prompt({
        type: 'confirm',
        name: 'confirmSave',
        message: 'Save this configuration?',
        default: true,
      });
      if (!confirmSave) {
        outro('Nothing saved.');
        return;
      }

      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
      log.success(`Configuration saved → ${CONFIG_PATH}`);

      // Update global config in memory so adapters can use it immediately
      global.AGENTOS.config = config;

      if (selectedDomains.includes('mikrotik') && config.adapters.mikrotik) {
        const { applyNow } = await prompt({
          type: 'confirm',
          name: 'applyNow',
          message: 'Would you like to apply setup.rsc to your default MikroTik router now?',
          default: true,
        });

        if (applyNow) {
          const s = spinner();
          s.start('Applying setup.rsc to MikroTik router…');
          try {
            const mk = config.adapters.mikrotik;
            const res = await onboardRouter({
              host: mk.host,
              user: mk.user,
              password: mk.password,
              port: mk.port,
            });
            if (res.success) {
              s.stop('✓ setup.rsc applied successfully');
            } else {
              s.stop(`— Failed to apply setup.rsc: ${res.error}`);
            }
          } catch (err) {
            s.stop(`— Error applying setup: ${err.message}`);
          }
        }
      }

      // ── Step 6.5: Account Authentication ──────────────────────────────────
      note(
        chalk.gray(
          'Optional: connect a GitHub or Firebase account for identity and `agentos whoami`.'
        ),
        chalk.whiteBright.bold('🔗 Step 6.5 — Account Authentication')
      );
      const loginInternal = require('./login')._internal;
      const alreadyLoggedIn = loginInternal.readCredentials();
      if (alreadyLoggedIn) {
        log.info(`Already connected as ${alreadyLoggedIn.login} (${alreadyLoggedIn.provider}).`);
      } else {
        const { connectionType } = await prompt({
          type: 'list',
          name: 'connectionType',
          message: 'Connect an account now?',
          choices: [
            { value: 'firebase', name: 'Firebase (OAuth via br3eze.africa/login)' },
            { value: 'github', name: 'GitHub (OAuth device flow)' },
            { value: 'none', name: 'Skip for now' },
          ],
        });

        if (connectionType === 'firebase') {
          try {
            const creds = await loginInternal.firebaseLogin({ log, note });
            loginInternal.writeCredentials(creds);
            log.success(`Connected as ${creds.login}`);
          } catch (err) {
            log.warn(`Firebase login failed: ${err.message}`);
          }
        } else if (connectionType === 'github') {
          const ghClientId = process.env.GITHUB_CLIENT_ID;
          if (!ghClientId) {
            log.warn('GITHUB_CLIENT_ID not set — skipping. Set it later and run `agentos login`.');
          } else {
            try {
              const { accessToken, scope } = await loginInternal.deviceFlowLogin({
                clientId: ghClientId,
                scope: 'read:user repo',
                log,
                note,
              });
              const userRes = await fetch('https://api.github.com/user', {
                headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'AgentOS-CLI' },
              });
              const user = await userRes.json();
              if (userRes.ok) {
                loginInternal.writeCredentials({
                  provider: 'github',
                  login: user.login,
                  name: user.name || user.login,
                  avatar: user.avatar_url,
                  accessToken,
                  scope,
                });
                log.success(`Connected as ${user.login}`);
              } else {
                log.warn(`Could not fetch GitHub profile: ${user.message || 'unknown error'}`);
              }
            } catch (err) {
              log.warn(`GitHub connection skipped: ${err.message}`);
            }
          }
        }
      }

      outro(chalk.bgGreen.black.bold(' ✨ AgentOS is configured and ready! Run: agentos gateway '));
      restoreLogs();
      process.exit(0);
    });
};
