#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function valueAfter(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const home = os.homedir();
const profile = process.env.AGENTOS_PROFILE || valueAfter('--profile', 'default');
const profileDir = profile === 'default' ? path.join(home, '.agentos') : path.join(home, `.agentos-${profile}`);
const installDir = path.resolve(valueAfter('--install-dir', path.join(profileDir, 'app')));
const configPath = path.join(profileDir, 'config.json');
const stateDir = path.join(profileDir, 'state');
const credentialsPath = path.join(profileDir, 'credentials.json');
const envPath = path.join(installDir, '.env');

fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(installDir, { recursive: true, mode: 0o755 });

if (!fs.existsSync(configPath)) {
  const config = {
    name: 'AgentOS',
    version: 'installed',
    gateway: {
      host: '127.0.0.1',
      port: 19876,
      token: crypto.randomBytes(32).toString('hex')
    },
    llm: {
      strategy: 'open-model-first',
      primary: process.env.AGENTOS_LLM_PRIMARY || 'ollama',
      fallbacks: ['openrouter', 'openai', 'xai']
    },
    features: {
      telegramBot: false,
      whatsapp: false,
      webDashboard: true,
      websocketApi: true
    }
  };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

if (!fs.existsSync(envPath)) {
  const contents = [
    '# AgentOS runtime overrides. Do not commit this file.',
    '# Secrets are intentionally not generated or copied by the installer.',
    '# Use `agentos login` for operator credentials or a secret manager for API keys.',
    'NODE_ENV=production',
    'AGENTOS_PROFILE=' + profile,
    ''
  ].join('\n');
  fs.writeFileSync(envPath, contents, { mode: 0o600 });
}

for (const file of [configPath, envPath, credentialsPath]) {
  try { fs.chmodSync(file, 0o600); } catch { /* file may not exist yet */ }
}

console.log(JSON.stringify({ profile, profileDir, installDir, configPath, stateDir, envPath }, null, 2));
