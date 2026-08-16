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
import TelegramChannel from './src/core/channels/TelegramChannel.js';
import startLogsDaemon from './src/cli/daemon/logs-daemon.js';
/**
 * AgentOS — Master Entry Point
 * Consolidates CLI and Daemon logic.
 */

const chalk = _chalk.default || _chalk;
const boxen = _boxen.default || _boxen;

// ── Config & Brand ────────────────────────────────────────────────────────────

function getProfileDir() {
    const profile = process.env.AGENTOS_PROFILE ||
        (process.argv.includes('--dev') ? 'dev' : 'default');
    if (profile === 'default') return path.join(os.homedir(), '.agentos');
    return path.join(os.homedir(), `.agentos-${profile}`);
}

global.AGENTOS = {
    BRAND,
    CONFIG_PATH,
    STATE_PATH,
    PROFILE_DIR: getProfileDir(),
    IS_DEV: process.argv.includes('--dev')
};

// ── Ensure Data Directories ───────────────────────────────────────────────────
[
    path.join(process.cwd(), 'data', 'sessions'),
    path.join(process.cwd(), 'data', 'skills'),
    path.join(process.cwd(), 'logs'),
    STATE_PATH
].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ── Banner ────────────────────────────────────────────────────────────────────
const showBanner = () => {
    if (!process.argv.includes('--no-banner') && !process.argv.includes('--json')) {
        try {
            console.log(boxen(
                `${chalk.cyan.bold(`${BRAND.emoji} ${BRAND.name} ${BRAND.version}`)}\n` +
                `${chalk.gray(BRAND.tagline)}`,
                { padding: 1, margin: 0, borderStyle: 'round', borderColor: 'cyan' }
            ));
        } catch (_) {
            console.log(`\n  ${BRAND.emoji} ${BRAND.name} ${BRAND.version} — ${BRAND.tagline}\n`);
        }
    }
};

// ── CLI Configuration ─────────────────────────────────────────────────────────
program
    .name('agentos')
    .description(`${BRAND.name} — Modular AI Agent Operating System`)
    .version(BRAND.version, '-V, --version', 'Output version number')
    .option('--dev', 'Use dev profile (~/.agentos-dev)')
    .option('--profile <name>', 'Named profile (isolates config/state)')
    .option('--log-level <level>', 'Log level: silent|error|warn|info|debug', 'info')
    .option('--no-color', 'Disable ANSI colors')
    .option('--json', 'Machine-readable JSON output')
    .option('--no-banner', 'Suppress startup banner')
    .configureOutput({
        writeErr: str => process.stdout.write(str),
        getOutHelpWidth: () => 100,
        getErrHelpWidth: () => 100
    });

// ── Command Registration ──────────────────────────────────────────────────────
_cmd_onboard(program);
_cmd_ask(program);
_cmd_gateway(program);
_cmd_networks(program);
_cmd_users(program);
_cmd_voucher(program);
_cmd_config(program);
_cmd_doctor(program);
_cmd_domain(program);
_cmd_status(program);
_cmd_dashboard(program);
_cmd_skill(program);
_cmd_dahua(program);
_cmd_starlink(program);
_cmd_mikrotik(program);
_cmd_agent(program);
_cmd_shop(program);
_cmd_wacli(program);
_cmd_telegram(program);
_cmd_google(program);
_cmd_update(program);
_cmd_tailscale(program);
_cmd_cli(program);
_cmd_grok(program);

// ── Logging Daemon ────────────────────────────────────────────────────────────
program
    .command('logs')
    .description('Start the standalone logging daemon (UDP 5001)')
    .action(() => {
        startLogsDaemon({ json: process.argv.includes('--json') });
    });


// ── Diagnostics Command ───────────────────────────────────────────────────────
program
    .command('debug [mode]')
    .description('Perform system-wide or component diagnostics')
    .action(async (mode) => {
        showBanner();

        if (mode === 'telegram') {
            console.log(chalk.cyan('\n--- Telegram Channel Diagnostic ---\n'));
            try {
                const bot = new TelegramChannel({
                    token: process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN
                });
                const initialized = await bot.initialize();
                if (initialized === false) {
                    console.log(chalk.yellow('⚠ Could not start polling: another instance is active.'));
                    const me = await bot.bot.getMe();
                    console.log(chalk.gray('  Bot Info: '), `@${me.username} (${me.first_name})`);
                    process.exit(0);
                }

                console.log(chalk.green('✔ Initialized successfully'));
                const me = await bot.bot.getMe();
                console.log(chalk.gray('  Bot Info: '), `@${me.username} (${me.first_name})`);

                // Allow some time for polling to start and catch potential immediate conflicts
                await new Promise(r => setTimeout(r, 2000));

                await bot.destroy();
                process.exit(0);
            } catch (err) {
                console.error(chalk.red('✘ Initialization failed:'), err.message);
                process.exit(1);
            }
        }

        console.log(chalk.cyan('\n🩺 AgentOS System Diagnostics\n'));

        const { PROFILE_DIR, CONFIG_PATH } = global.AGENTOS;
        console.log(chalk.gray('  Profile:  '), chalk.white(PROFILE_DIR));
        console.log(chalk.gray('  Config:   '), fs.existsSync(CONFIG_PATH) ? chalk.green('Found') : chalk.red('Missing'));

        const envKeys = ['GEMINI_API_KEY', 'MIKROTIK_IP', 'FIREBASE_PROJECT_ID', 'TELEGRAM_BOT_TOKEN'];
        console.log(chalk.gray('\n  Environment:'));
        envKeys.forEach(k => {
            const val = process.env[k];
            console.log(`    ${chalk.gray(k.padEnd(20))}: ${val ? chalk.green('✓ Set') : chalk.yellow('○ Not Set')}`);
        });

        console.log(chalk.gray('\n  Running module diagnostics...'));
        try {
            // Trigger voucher debug if available
            console.log(chalk.gray('  - Vouchers: '));
            const db = await getDatabase();
            const stats = await db.getStats();
            console.log(chalk.green(`    ✓ ${stats.total} vouchers found (${stats.active} active)`));
        } catch (e) {
            console.log(chalk.red(`    ❌ Voucher check failed: ${e.message}`));
        }

        console.log(chalk.cyan('\n✨ Use "agentos status" for live connection checks.\n'));
    });

// ── Main Logic ────────────────────────────────────────────────────────────────
const run = async () => {
    // Helper to check if any known command is in argv
    const commands = program.commands.flatMap(c => [c.name(), ...(c.aliases?.() || [])]);
    const hasCommand = process.argv.some(arg => commands.includes(arg));

    const isMetaCommand = process.argv.includes('-h') || process.argv.includes('--help') || process.argv.includes('-V') || process.argv.includes('--version');
    if (!hasCommand && !isMetaCommand) {
        showBanner();
        console.log(chalk.yellow('! No command specified, defaulting to: gateway\n'));
        // Insert 'gateway' before any options but after node/script
        const newArgs = [...process.argv];
        newArgs.splice(2, 0, 'gateway');
        await program.parseAsync(newArgs);
    } else {
        if (!process.argv.includes('gateway') && !isMetaCommand) showBanner();
        await program.parseAsync(process.argv);
    }

    // Centrally manage process exit for commands that should terminate.
    const daemonCommands = ['gateway', 'logs'];
    const currentCommand = program.args[0] || (process.argv.some(arg => daemonCommands.includes(arg)) ? 'gateway' : null);

    const isDashboard = currentCommand === 'dashboard';
    const isRefreshing = process.argv.includes('--refresh');

    const shouldExit = !daemonCommands.includes(currentCommand) &&
        (!isDashboard || !isRefreshing);

    if (shouldExit) {
        // Set exit code and let the event loop drain naturally.
        // Calling process.exit(0) abruptly on Windows can trigger 
        // libuv assertion failures if handles are still closing.
        process.exitCode = 0;
    }
};

process.on('unhandledRejection', (reason, promise) => {
    const errorMsg = `\n✗ Unhandled Rejection at: ${promise} reason: ${reason}`;
    console.error(chalk.red(errorMsg));

    // Log to file if logger is available
    try {
        logger.error('Unhandled Rejection', { reason, stack: reason?.stack });
    } catch (e) {
        // Fallback if logger is not ready
    }

    // Only exit if NOT in gateway mode, to keep the daemon running
    if (!process.argv.includes('gateway')) {
        process.exit(1);
    }
});

run().catch(err => {
    console.error(chalk.red('Fatal Error:'), err);
    process.exit(1);
});