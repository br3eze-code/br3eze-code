import _cmd_onboard from './src/cli/commands/onboard.js';
import _cmd_ask from './src/cli/commands/ask.js';
import _cmd_gateway from './src/cli/commands/gateway.js';
import _cmd_networks from './src/cli/commands/networks.js';
import _cmd_users from './src/cli/commands/users.js';
import _cmd_voucher from './src/cli/commands/voucher.js';
import _cmd_config from './src/cli/commands/config.js';
import _cmd_doctor from './src/cli/commands/doctor.js';
import _cmd_domain from './src/cli/commands/domain.js';
import _cmd_status from './src/cli/commands/status.js';
import _cmd_dashboard from './src/cli/commands/dashboard.js';
import _cmd_skill from './src/cli/commands/skill.js';
import _cmd_dahua from './src/cli/commands/dahua.js';
import _cmd_starlink from './src/cli/commands/starlink.js';
import _cmd_mikrotik from './src/cli/commands/mikrotik.js';
import _cmd_agent from './src/cli/commands/agent.js';
import _cmd_shop from './src/cli/commands/shop.js';
import _cmd_wacli from './src/cli/commands/wacli.js';
import _cmd_telegram from './src/cli/commands/telegram.js';
import _cmd_google from './src/cli/commands/google.js';
import _cmd_update from './src/cli/commands/update.js';
import _cmd_tailscale from './src/cli/commands/tailscale.js';
import _cmd_cli from './src/cli/commands/cli.js';
import _cmd_grok from './src/cli/commands/grok.js';
import { program } from 'commander';
import _chalk from 'chalk';
import _boxen from 'boxen';
import fs from 'fs';
import path from 'path';
import os from 'os';
import 'dotenv/config';
import { BRAND, CONFIG_PATH, STATE_PATH, getConfig } from './src/core/config.js';
import { getDatabase } from './src/core/database.js';
import { logger } from './src/core/logger.js';
import TelegramChannel from './src/channels/telegram.js';
import startLogsDaemon from './src/cli/daemon/logs-daemon.js';
/**
 * AgentOS — Master Entry Point
 * Consolidates CLI and Daemon logic.
 */

const chalk = _chalk.default || _chalk;
const boxen = _boxen.default || _boxen;

// ── Config & Brand ────────────────────────────────────────────────────────────
function getProfileDir() {
    const profile = process.env.AGENTOS_PROFILE || (process.argv.includes('--dev') ? 'dev' : 'default');
    if (profile === 'default') return path.join(os.homedir(), '.agentos');
    return path.join(os.homedir(), `.agentos-${profile}`);
}

global.AGENTOS = { BRAND, CONFIG_PATH, STATE_PATH, PROFILE_DIR: getProfileDir(), IS_DEV: process.argv.includes('--dev') };

[
    path.join(process.cwd(), 'data', 'sessions'),
    path.join(process.cwd(), 'data', 'skills'),
    path.join(process.cwd(), 'logs'),
    STATE_PATH
].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const showBanner = () => {
    if (!process.argv.includes('--no-banner') && !process.argv.includes('--json')) {
        try { console.log(boxen(`${chalk.cyan.bold(`${BRAND.emoji} ${BRAND.name} ${BRAND.version}`)}\n${chalk.gray(BRAND.tagline)}`, { padding: 1, margin: 0, borderStyle: 'round', borderColor: 'cyan' })); }
        catch (_) { console.log(`\n  ${BRAND.emoji} ${BRAND.name} ${BRAND.version} — ${BRAND.tagline}\n`); }
    }
};

program.name('agentos').description(`${BRAND.name} — Modular AI Agent Operating System`).version(BRAND.version, '-V, --version', 'Output version number').option('--dev', 'Use dev profile (~/.agentos-dev)').option('--profile <name>', 'Named profile (isolates config/state)').option('--log-level <level>', 'Log level: silent|error|warn|info|debug', 'info').option('--no-color', 'Disable ANSI colors').option('--json', 'Machine-readable JSON output').option('--no-banner', 'Suppress startup banner').configureOutput({ writeErr: str => process.stdout.write(str), getOutHelpWidth: () => 100, getErrHelpWidth: () => 100 });
