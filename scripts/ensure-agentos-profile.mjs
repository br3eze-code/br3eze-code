import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const profile = process.argv.includes('--dev') ? 'dev' : process.env.AGENTOS_PROFILE || 'default';
const dir = path.join(os.homedir(), profile === 'default' ? '.agentos' : `.agentos-${profile}`);
const state = path.join(dir, 'state');
const configPath = path.join(dir, 'config.json');
fs.mkdirSync(state, { recursive: true, mode: 0o700 });
if (!fs.existsSync(configPath)) {
  const config = {
    name: 'AgentOS',
    version: '2026.9.23',
    gateway: { host: '127.0.0.1', port: 19876 },
    channels: [],
    onboarding: { completed: false, createdAt: new Date().toISOString() }
  };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  console.log(`[AgentOS] Created ${profile} profile at ${configPath}`);
}
console.log(`[AgentOS] Profile ready: ${dir}`);
