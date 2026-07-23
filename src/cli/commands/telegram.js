'use strict';
/**
 * agentos telegram — CLI commands for Telegram channel management
 *
 * Usage:
 *   agentos telegram send "Hello world"
 *   agentos telegram send "Hello world" --chat 7733493073
 *   agentos telegram status
 *   agentos telegram test
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

module.exports = (program) => {
    // ── tg:send ───────────────────────────────────────────────────────────────
    program
        .command('tg:send <message>')
        .alias('tg')
        .description('Send a message to Telegram')
        .option('--chat <id>', 'Target chat ID (defaults to first in ALLOWED_CHAT_IDS)')
        .option('--all', 'Broadcast to all allowed chat IDs')
        .action(async (message, options) => {
            const { outro, cancel } = await import('@clack/prompts');
            const _chalk = require('chalk');
            const chalk  = _chalk.default || _chalk;

            const token = process.env.TELEGRAM_TOKEN;
            if (!token) {
                cancel('TELEGRAM_TOKEN not set in .env');
                process.exit(1);
            }

            const rawIds = (process.env.ALLOWED_CHAT_IDS || '')
                .split(',')
                .map(id => id.trim())
                .filter(id => id && !id.includes('@')); // Telegram IDs only (no WhatsApp @s.whatsapp.net etc.)

            if (!rawIds.length && !options.chat) {
                cancel('No Telegram chat IDs found. Set ALLOWED_CHAT_IDS in .env or use --chat <id>');
                process.exit(1);
            }

            const targets = options.all
                ? rawIds
                : [options.chat || rawIds[0]];

            const sendTo = (chatId) => new Promise((resolve, reject) => {
                const body = encodeURIComponent(message);
                const url  = `https://api.telegram.org/bot${token}/sendMessage?chat_id=${chatId}&text=${body}&parse_mode=Markdown`;
                https.get(url, (r) => {
                    let d = '';
                    r.on('data', c => d += c);
                    r.on('end', () => {
                        try {
                            const json = JSON.parse(d);
                            resolve({ chatId, ok: json.ok, result: json.result, error: json.description });
                        } catch {
                            resolve({ chatId, ok: false, error: d });
                        }
                    });
                }).on('error', reject);
            });

            let sent = 0;
            for (const chatId of targets) {
                try {
                    const res = await sendTo(chatId);
                    if (res.ok) {
                        console.log(chalk.green(`✅ Sent to ${chatId} (msg_id: ${res.result?.message_id})`));
                        sent++;
                    } else {
                        console.log(chalk.red(`❌ Failed for ${chatId}: ${res.error}`));
                    }
                } catch (err) {
                    console.log(chalk.red(`❌ Network error for ${chatId}: ${err.message}`));
                }
            }

            outro(chalk.green(`Sent ${sent}/${targets.length} messages`));
        });

    // ── tg:status ─────────────────────────────────────────────────────────────
    program
        .command('tg:status')
        .description('Check Telegram bot connectivity and polling status')
        .action(async () => {
            const { outro, cancel } = await import('@clack/prompts');
            const _chalk = require('chalk');
            const chalk  = _chalk.default || _chalk;

            const token = process.env.TELEGRAM_TOKEN;
            if (!token) {
                cancel('TELEGRAM_TOKEN not set in .env');
                return;
            }

            // 1. Check lock file for polling PID
            const { STATE_PATH } = global.AGENTOS || {};
            const lockFile = STATE_PATH ? path.join(STATE_PATH, '.telegram_bot.lock') : null;
            if (lockFile && fs.existsSync(lockFile)) {
                const pid = fs.readFileSync(lockFile, 'utf8').trim();
                let alive = false;
                try { process.kill(parseInt(pid), 0); alive = true; } catch (_) {}
                console.log(alive
                    ? chalk.green(`✅ Polling active (PID: ${pid})`)
                    : chalk.yellow(`⚠  Lock file exists but PID ${pid} is not running`));
            } else {
                console.log(chalk.yellow('⚠  No polling lock file found (bot may not be running)'));
            }

            // 2. API connectivity check via getMe
            await new Promise((resolve) => {
                const url = `https://api.telegram.org/bot${token}/getMe`;
                https.get(url, (r) => {
                    let d = '';
                    r.on('data', c => d += c);
                    r.on('end', () => {
                        try {
                            const json = JSON.parse(d);
                            if (json.ok) {
                                const b = json.result;
                                console.log(chalk.green(`✅ Bot: @${b.username} (${b.first_name}) — ID: ${b.id}`));
                            } else {
                                console.log(chalk.red(`❌ Bot API error: ${json.description}`));
                            }
                        } catch {
                            console.log(chalk.red(`❌ Invalid API response: ${d}`));
                        }
                        resolve();
                    });
                }).on('error', (e) => {
                    console.log(chalk.red(`❌ Network error: ${e.message}`));
                    resolve();
                });
            });

            // 3. Show allowed IDs
            const rawIds = (process.env.ALLOWED_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
            const tgIds  = rawIds.filter(id => !id.includes('@'));
            console.log(chalk.cyan(`📋 Telegram allowed IDs: ${tgIds.length ? tgIds.join(', ') : '(none — open to all)'}`));

            outro('Status check complete');
        });

    // ── tg:test ───────────────────────────────────────────────────────────────
    program
        .command('tg:test')
        .description('Send a test message to all allowed Telegram chat IDs')
        .action(async () => {
            const { outro } = await import('@clack/prompts');
            const _chalk = require('chalk');
            const chalk  = _chalk.default || _chalk;

            const token = process.env.TELEGRAM_TOKEN;
            if (!token) { console.log(chalk.red('TELEGRAM_TOKEN not set')); return; }

            const tgIds = (process.env.ALLOWED_CHAT_IDS || '')
                .split(',').map(s => s.trim())
                .filter(id => id && !id.includes('@'));

            if (!tgIds.length) {
                console.log(chalk.yellow('No Telegram chat IDs configured in ALLOWED_CHAT_IDS'));
                return;
            }

            const ts = new Date().toLocaleTimeString();
            const text = encodeURIComponent('🧪 *AgentOS Test* — bot is alive!\n`' + ts + '`');

            for (const chatId of tgIds) {
                await new Promise((resolve) => {
                    https.get(
                        `https://api.telegram.org/bot${token}/sendMessage?chat_id=${chatId}&text=${text}&parse_mode=Markdown`,
                        (r) => {
                            let d = '';
                            r.on('data', c => d += c);
                            r.on('end', () => {
                                const json = JSON.parse(d);
                                console.log(json.ok
                                    ? chalk.green(`✅ Test sent to ${chatId}`)
                                    : chalk.red(`❌ Failed for ${chatId}: ${json.description}`));
                                resolve();
                            });
                        }
                    ).on('error', (e) => {
                        console.log(chalk.red(`❌ Network error: ${e.message}`));
                        resolve();
                    });
                });
            }

            outro('Test complete');
        });
};
