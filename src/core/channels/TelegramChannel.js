import TelegramBot from 'node-telegram-bot-api';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';
import { BaseChannel } from './BaseChannel.js';
import { BRAND } from '../config.js';
import { acquireBotLock, releaseBotLock, LOCK_FILE } from '../../utils/bot-lock.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/**
 * TelegramChannel — AgentOS core channel
 * Fixes applied:
 *   - undefined `token` → `this.token`
 *   - `this.mikrotik` now injected from config.mikrotik or agent
 *   - initialize() / send() / broadcast() implement BaseChannel contract
 */

const { printVoucher } = require('../printer');   // server-side fallback
const { PrintBroker } = require('../print-broker'); // unified broker


/** Minimal escaping for Telegram's HTML parse_mode — only &, <, > are special there. */
function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Wraps credential-bearing text (e.g. rtsp://user:pass@host/...) so it isn't visible until tapped. */
function spoiler(s) {
    return `<tg-spoiler>${escapeHtml(s)}</tg-spoiler>`;
}

class TelegramChannel extends BaseChannel {
    static getMetadata() {
        return {
            name: 'Telegram',
            description: 'Global reach via Telegram bots',
            configFields: [
                {
                    "name": "token",
                    "type": "password",
                    "message": "Telegram Bot Token:",
                    "required": true
                }
            ]
        };
    }

    async validateConfig() {
        if (!this.config.token) return { valid: false, error: 'Missing token' };
        if (!/^[\d]+:[A-Za-z0-9_-]{35,}$/.test(this.config.token)) return { valid: false, error: 'Invalid token format' };
        return { valid: true, error: null };
    }

    constructor(config, agent) {
        super(config, agent);

        // ── Token validation ─────────────────────────────────────────────────
        this.token = config.token;
        if (!this.token || !/^[\d]+:[A-Za-z0-9_-]{35,}$/.test(this.token)) {
            throw new Error(
                'TelegramChannel: invalid or missing bot token. ' +
                'Set telegram.token in config or TELEGRAM_BOT_TOKEN env var.'
            );
        }

        // ── MikroTik client (lazy — only required if commands are used) ──────
        // Pulled from agent context or config; falls back gracefully at runtime
        this.mikrotik = agent?.mikrotik || config.mikrotik || null;

        // ── Bot instance ─────────────────────────────────────────────────────
        this.bot = new TelegramBot(this.token, {
            polling: {
                interval: 2000, // Increased to reduce polling frequency and conflict risk
                autoStart: false, // started in initialize()
                params: {
                    timeout: 20, // Long polling timeout
                    allowed_updates: ['message', 'callback_query']
                }
            },
            request: {
                timeout: 30000,
                agent: new https.Agent({
                    keepAlive: true,
                    maxSockets: 10,
                    maxFreeSockets: 5,
                    timeout: 30000,
                    freeSocketTimeout: 30000
                })
            }
        });

        // Rate limiting and cache
        this.messageCache = new Map();
        this.rateLimiter = new Map();
        this.pendingReboots = new Set();
        this.pendingInputs = new Map(); // chatId -> { action, data }
        this._alertState = new Map();   // key -> lastSentTimestamp
        this.cacheCleanup = setInterval(() => this._clearOldCache(), 60000);

        logger.info('TelegramChannel: constructed');
        global.agentosbot = this.bot;
    }

    // ── BaseChannel contract ─────────────────────────────────────────────────

    async initialize() {
        if (this.connected) {
            logger.warn('TelegramChannel: already initialized — skipping duplicate polling start');
            return this;
        }

        // ── Singleton Lock Check (Atomic) ────────────────────────────────────
        if (!acquireBotLock()) {
            logger.warn('TelegramChannel: could not acquire bot lock — another instance may be running. Polling will be skipped.');
            return false;  // Return false so ChannelManager knows polling was skipped
        }


        // Prevent duplicate handler registration if re-initializing
        if (!this._handlersRegistered) {
            this._registerHandlers();
            this._handlersRegistered = true;
        }

        // ── Enhanced Polling Error Handler ───────────────────────────────────
        if (!this._pollingErrorHandlerRegistered) {
            this.bot.on('polling_error', (err) => {
                const isConflict = err.code === 'ETELEGRAM' && err.response?.body?.description?.includes('Conflict');
                const health = this.mikrotik?.state?.lastKnownHealth || {};
                const context = health.voltage ? ` [Voltage: ${health.voltage}V, Temp: ${health.temperature}C]` : '';

                if (isConflict) {
                    logger.error(`TelegramChannel: 409 Conflict${context}. Another bot instance is polling. (Own PID: ${process.pid})`);
                    // Stop polling if conflict detected
                    this.bot.stopPolling().catch(() => { });
                    this.connected = false;
                    this.emit('status', 'conflict');
                    
                    if (this._conflictRetryTimer) clearTimeout(this._conflictRetryTimer);
                    // Attempt recovery after a delay if we still hold the lock
                    this._conflictRetryTimer = setTimeout(() => {
                        if (fs.existsSync(LOCK_FILE)) {
                            const pid = fs.readFileSync(LOCK_FILE, 'utf8').trim();
                            if (pid === process.pid.toString()) {
                                logger.info('TelegramChannel: Retrying polling after conflict...');
                                this.bot.startPolling({ restart: true }).catch(() => {});
                            }
                        }
                    }, 30000); // 30s backoff
                } else if (err.code === 'EFATAL' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.message?.includes('ETIMEDOUT')) {
                    logger.debug(`TelegramChannel: Network interruption${context}. Auto-retrying...`);
                    
                    if (this._pollingRetryTimer) clearTimeout(this._pollingRetryTimer);
                    // Ensure we resume polling if the library gave up
                    this._pollingRetryTimer = setTimeout(() => {
                        if (this.bot && !this.bot.isPolling()) {
                            logger.info('TelegramChannel: Restarting polling after network error...');
                            this.bot.startPolling({ restart: true }).catch(() => {});
                        }
                    }, 5000);
                } else {
                    logger.error(`TelegramChannel polling error: ${err.message}${context}`);
                }
            });

            this.bot.on('error', (err) => {
                logger.error(`TelegramChannel fatal error: ${err.message}`);
            });

            this._pollingErrorHandlerRegistered = true;
        }

        if (!this.bot.isPolling()) {
            // Do NOT await startPolling as it might block if the network is flaky
            // and the library performs internal getMe calls.
            this.bot.startPolling().then(() => {
                this.connected = true;
                logger.info('TelegramChannel: polling started');
                this.emit('status', 'connected');
            }).catch((err) => {
                logger.error(`TelegramChannel: failed to start polling: ${err.message}`);
                this.connected = false;
            });
        } else {
            this.connected = true;
        }

        return this;
    }
    


    /**
     * Send a text message to a specific chat.
     * @param {string|number} userId  — Telegram chat ID
     * @param {string|object} message — plain string or { text, parse_mode, reply_markup }
     */
    async send(userId, message) {
        const text = typeof message === 'string' ? message : message.text || JSON.stringify(message);
        const options = typeof message === 'object'
            ? { parse_mode: message.parse_mode, reply_markup: message.reply_markup }
            : {};
        return this.bot.sendMessage(userId, text, options);
    }

    async broadcast(message) {
        return this.sendToAll(message);
    }

    async sendToAll(message) {
        if (typeof message === 'object') {
            if (message.text) message = message.text;
            else return { success: true, skipped: true, reason: 'unsupported_message_format' };
        }

        let sentCount = 0;
        const telegramChats = (this.config.allowed_ids || []).filter(id => !String(id).includes('@'));
        for (const chatId of telegramChats) {
            try {
                await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                sentCount++;
            } catch (err) {
                logger.warn(`Failed to send broadcast to ${chatId}: ${err.message}`);
            }
        }
        return { success: true, sentCount };
    }

    async alertOnce(alertKey, message) {
        const lastSent = this._alertState.get(alertKey);
        const now = Date.now();
        // Send alert if not sent before, or if more than 2 hours have passed since last alert
        if (!lastSent || now - lastSent > 2 * 60 * 60 * 1000) {
            this._alertState.set(alertKey, now);
            return this.sendToAll(message);
        }
        return { success: true, skipped: true };
    }

    async destroy() {
        logger.info('TelegramChannel: destroying...');
        if (this.cacheCleanup) clearInterval(this.cacheCleanup);
        if (this._conflictRetryTimer) clearTimeout(this._conflictRetryTimer);
        if (this._pollingRetryTimer) clearTimeout(this._pollingRetryTimer);

        try {
            if (this.bot && this.bot.isPolling()) {
                await Promise.race([this.bot.stopPolling(), new Promise(r => setTimeout(r, 2000))]);
            }
        } catch (e) {
            logger.warn(`TelegramChannel: Error stopping polling: ${e.message}`);
        }

        if (this.bot) this.bot.removeAllListeners();
        this.connected = false;

        // Cleanup lock file
        releaseBotLock();

        await super.destroy();
        logger.info('TelegramChannel: destroyed');
    }

    /**
     * Check if ChatID or UID is authorized
     * @param {string|number} chatId 
     * @param {string} uid 
     */
    isAuthorized(chatId, uid = null) {
        const allowed = this.config.allowed_ids || [];
        if (allowed.length === 0) return true;
        const sChatId = String(chatId);

        for (const entry of allowed) {
            const sEntry = String(entry).trim();
            if (!sEntry) continue;
            // 1. Direct match (ChatID or UID)
            if (sEntry === sChatId || (uid && sEntry === uid)) return true;
            // 2. Prefix match for UID
            if (uid && sEntry === `uid:${uid}`) return true;
        }
        return false;
    }

    // ── Rate limiting ────────────────────────────────────────────────────────

    _checkRateLimit(chatId) {
        const now = Date.now();
        const key = chatId.toString();
        const limit = 30;

        if (!this.rateLimiter.has(key)) {
            this.rateLimiter.set(key, { count: 1, resetTime: now + 60_000 });
            return { allowed: true, remaining: limit - 1, resetTime: now + 60_000 };
        }

        const slot = this.rateLimiter.get(key);
        if (now > slot.resetTime) {
            slot.count = 1;
            slot.resetTime = now + 60_000;
            return { allowed: true, remaining: limit - 1, resetTime: slot.resetTime };
        }

        if (slot.count >= limit) {
            return { allowed: false, remaining: 0, resetTime: slot.resetTime };
        }

        slot.count++;
        return { allowed: true, remaining: limit - slot.count, resetTime: slot.resetTime };
    }

    _rl(fn, requiredRole = null) {
        return async (msg, match) => {
            const chatId = (msg?.chat?.id) ?? (msg?.message?.chat?.id);
            if (!chatId) return;
            const sChatId = String(chatId);

            // 1. Identity Resolution & Bridging
            // Resolve identity FIRST to support UID-based authorization
            let authUser = null;
            let resolvedUid = null;

            try {
                const { getDatabase } = require('../database');
                const db = await getDatabase();
                const from = msg.from || msg.message?.from;

                if (from && db.db) {
                    // Only sync to Firestore when Firebase is reachable; otherwise SQLite-only
                    await db.upsertUser(sChatId, {
                        username: from.username || null,
                        firstName: from.first_name || '',
                        lastName: from.last_name || '',
                        platform: 'telegram',
                        channels: { telegram: sChatId },
                    }).catch(e => logger.warn(`Telegram user sync failed: ${e.message}`));

                    // Bridge to Firebase Auth (resolveFirebaseUser already guards db.db internally)
                    authUser = await db.resolveFirebaseUser(sChatId, {
                        channel: 'telegram',
                        channelId: sChatId,
                    }).catch(() => null);
                } else if (from && db.sqlite) {
                    // Offline path: sync to SQLite only, no Firebase round-trip
                    await db.upsertUser(sChatId, {
                        username: from.username || null,
                        firstName: from.first_name || '',
                        lastName: from.last_name || '',
                        platform: 'telegram',
                        channels: { telegram: sChatId },
                    }).catch(e => logger.debug(`Telegram SQLite user sync failed: ${e.message}`));
                }

                if (authUser?.uid) {
                    resolvedUid = authUser.uid;
                    msg.userDoc = db.getUserDoc(resolvedUid);
                    msg._uid    = resolvedUid;
                    logger.debug(`[Telegram] Identity bridged: ${chatId} -> ${resolvedUid}`);
                } else {
                    // Fallback: use platform ID as the document ID
                    msg.userDoc = db.getUserDoc(sChatId);
                    msg._uid    = sChatId;
                }
            } catch (dbErr) {
                logger.error(`Telegram database resolution failed: ${dbErr.message}`);
            }

            // 2. Per-command role gate — mutating/operational commands require
            // role:'admin' on the user's Firestore doc, OR legacy allowed_ids
            // membership. Read-only/self-service commands (whoami, shop
            // browsing, menu, wallet, link, etc.) pass no requiredRole and
            // stay open to anyone — guests must be able to reach /shop, /link,
            // /ask etc. even after an admin has claimed allowed_ids, since
            // allowed_ids is an admin allowlist, not a bot-wide gate.
            if (requiredRole) {
                const legacyAllowed = this.isAuthorized(chatId, resolvedUid);
                if (!legacyAllowed) {
                    try {
                        const { getDatabase } = require('../database');
                        const db = await getDatabase();
                        const user = await db.getUser(resolvedUid || sChatId);
                        const role = user?.role || 'user';
                        if (role !== requiredRole && !(requiredRole === 'admin' && role === 'reseller')) {
                            logger.warn(`Unauthorized Telegram access attempt from ${chatId} (UID: ${resolvedUid || 'none'})`);
                            return this.bot.sendMessage(chatId, `❌ *Access Denied:* This command requires ${requiredRole} access.`, { parse_mode: 'Markdown' });
                        }
                    } catch (e) {
                        logger.error(`Telegram role check failed: ${e.message}`);
                        return this.bot.sendMessage(chatId, '❌ Could not verify permissions — try again shortly.');
                    }
                }
            }

            // 3. Rate Limiting
            const rlStatus = this._checkRateLimit(chatId);
            if (!rlStatus.allowed) {
                const seconds = Math.ceil((rlStatus.resetTime - Date.now()) / 1000);
                return this.bot.sendMessage(chatId, `⏳ *Rate limit* — please slow down. 0 mistakes available. Reset in ${seconds}s.`, { parse_mode: 'Markdown' });
            }

            // Inject rate limit info into the message object for the handler to use if needed
            msg._rl = rlStatus;

            try {
                await fn(msg, match);
            } catch (err) {
                // Suppress Telegram's "message is not modified" — it is not an actionable error
                // and must NOT create a new bubble via sendMessage.
                if (err?.response?.body?.description?.includes('message is not modified')) return;

                const isNetworkError = err.code === 'EFATAL' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.message?.includes('ETIMEDOUT');
                if (isNetworkError) {
                    logger.warn(`TelegramChannel handler network error: ${err.message}`, { chatId });
                    return; // Do not attempt to send an error message if the network is down
                }

                logger.error(`TelegramChannel handler error: ${err.message}`, { chatId });
                this.bot.sendMessage(chatId, `❌ Error: ${err.message}`).catch(() => { });
            }
        };
    }

    /**
     * Edit an existing message in place, silently ignoring Telegram's
     * "message is not modified" error so repeated button presses never
     * produce a new error bubble.
     */
    async _safeEdit(chatId, messageId, text, options = {}) {
        try {
            await this.bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                ...options
            });
        } catch (err) {
            const desc = err?.response?.body?.description || err.message || '';
            if (desc.includes('message is not modified')) return;
            if (desc.includes('no text in the message to edit') || desc.includes('message to edit not found')) {
                // If we cannot edit (e.g. it was a photo or deleted), send a new message instead
                return this.bot.sendMessage(chatId, text, options);
            }
            logger.error(`Telegram _safeEdit failed: ${desc}`, { chatId, messageId });
            // Final fallback: just send a message so the user isn't stuck
            return this.bot.sendMessage(chatId, text, options).catch(() => { });
        }
    }

    // ── Handler registration ──────────────────────────────────────────────────

    _registerHandlers() {
        this.bot.onText(/\/start(?:\s+(\S+))?/, this._rl(this._handleStart.bind(this)));
        this.bot.onText(/\/dashboard/, this._rl(this._handleDashboard.bind(this)));
        this.bot.onText(/\/users/, this._rl(this._handleUsers.bind(this), 'admin'));
        this.bot.onText(/\/stats/, this._rl(this._handleStats.bind(this), 'admin'));
        this.bot.onText(/\/voucher(?:\s+(\w+))?/, this._rl(this._handleVoucher.bind(this), 'admin'));
        this.bot.onText(/\/kick\s+(\S+)/, this._rl(this._handleKick.bind(this), 'admin'));
        this.bot.onText(/\/reboot/, this._rl(this._handleReboot.bind(this), 'admin'));
        this.bot.onText(/\/menu/, this._rl(this._handleMenu.bind(this)));
        this.bot.onText(/\/ping(?:\s+(.+))?/, this._rl(this._handlePing.bind(this)));
        this.bot.onText(/\/help/, this._rl(this._handleHelp.bind(this)));
        this.bot.onText(/\/pay(?:\s+(.+))?/, this._rl(this._handlePay.bind(this), 'admin'));
        this.bot.onText(/\/dahua(?:\s+(.+))?/, this._rl(this._handleDahua.bind(this), 'admin'));
        this.bot.onText(/\/shop(?:\s+(.+))?/, this._rl(this._handleShop.bind(this)));
        this.bot.onText(/\/claim/, this._rl(this._handleClaim.bind(this)));
        this.bot.onText(/\/link(?:\s+(.+))?/, this._rl(this._handleLink.bind(this)));
        this.bot.onText(/\/token/, this._rl(this._handleToken.bind(this), 'admin'));
        this.bot.onText(/\/ask\s+(.+)/, this._rl(this._handleAsk.bind(this)));
        this.bot.onText(/\/cli\s+(.+)/, this._rl(this._handleCli.bind(this), 'admin'));
        this.bot.onText(/\/api\s+(.+)/, this._rl(this._handleApi.bind(this), 'admin'));
        this.bot.onText(/\/tools/, this._rl(this._handleTools.bind(this), 'admin'));
        this.bot.onText(/\/tool\s+(\S+)(?:\s+(.*))?/, this._rl(this._handleTool.bind(this), 'admin'));
        this.bot.onText(/\/setup_router/, this._rl(this._handleSetupRouter.bind(this), 'admin'));
        this.bot.onText(/\/network/, this._rl(this._handleNetwork.bind(this), 'admin'));
        this.bot.onText(/\/wallet/, this._rl(this._handleWallet.bind(this)));
        this.bot.onText(/\/mistakes/, this._rl(this._handleMistakes.bind(this), 'admin'));
        this.bot.onText(/\/vouchers/, this._rl(this._handleVoucherList.bind(this), 'admin'));
        this.bot.onText(/\/reprint/, this._rl(this._handleReprint.bind(this), 'admin'));
        this.bot.onText(/\/transfer\s+(\S+)(?:\s+(.+))?/, this._rl(this._handleTransfer.bind(this)));
        this.bot.onText(/\/whoami/, this._rl(this._handleWhoAmI.bind(this)));
        this.bot.onText(/\/link(?:\s+(.+))?/, this._rl(this._handleLink.bind(this)));
        this.bot.onText(/\/printer(?:\s+(\S+)(?:\s+(.*))?)?/, this._rl(this._handlePrinter.bind(this), 'admin'));

        this.bot.on('callback_query', this._rl(this._handleCallback.bind(this)));

        // Natural language (non-command messages)
        this.bot.on('message', this._rl(async (msg) => {
            const { getChatRegistry } = require('../chat-registry');
            getChatRegistry().register('telegram', msg.chat.id.toString());

            if (!msg.text || msg.text.startsWith('/') || msg.via_bot) return;

            const pending = this.pendingInputs.get(msg.chat.id);
            if (pending) {
                this.pendingInputs.delete(msg.chat.id);
                await this._executePending(msg.chat.id, msg.text.trim(), pending.action);
                return;
            }

            await this._handleNaturalLanguage(msg);
        }));

        // polling_error and error are now handled in initialize() for better singleton management
    }

    // ── Command handlers ──────────────────────────────────────────────────────

    async _handleStart(msg, opts = {}) {
        const startPayload = Array.isArray(opts) ? opts[1] : undefined;
        if (startPayload && startPayload.startsWith('link_')) {
            return this._handleLink(msg, [null, startPayload.slice(5)]);
        }

        const chatId = msg.chat.id;
        const from = msg.from || {};
        const username = from.username || from.first_name || 'User';
        logger.audit?.('telegram_start', { chatId, username });

        const text = `🤖 *${BRAND.name}*\nWelcome, ${username}! I'm your network intelligence assistant.`;
        const reply_markup = {
            inline_keyboard: [
                [{ text: '🖥 Dashboard', callback_data: 'process:dashboard' }, { text: '⚙️ System', callback_data: 'process:status' }],
                [{ text: '🌐 Network', callback_data: 'process:network' }, { text: '🛠 Tools', callback_data: 'process:tools' }],
                [{ text: '👥 Users', callback_data: 'process:users' }, { text: '🎫 Voucher', callback_data: 'process:voucher' }],
                [{ text: '👛 Wallet', callback_data: 'process:wallet' }, { text: '💳 Payment', callback_data: 'process:pay' }],
                [{ text: '❓ Help', callback_data: 'process:help' }]
            ]
        };

        if (opts.editMessageId) {
            return this._safeEdit(chatId, opts.editMessageId, text, { parse_mode: 'Markdown', reply_markup });
        } else {
            await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup });
        }
    }

    async _handleDashboard(msg, opts = {}) {
        await this._sendDashboard(msg, opts);
    }

    async _handleUsers(msg, opts = {}) {
        const chatId = msg.chat.id;
        const text = '👥 *Users* — Select action:';
        const reply_markup = {
            inline_keyboard: [
                [{ text: '👁 Active', callback_data: 'users:active' }, { text: '📋 All', callback_data: 'users:all' }],
                [{ text: '➕ Add', callback_data: 'users:add' }, { text: '✏️ Edit', callback_data: 'users:edit' }],
                [{ text: '🚫 Kick', callback_data: 'users:kick' }, { text: '🗑 Remove', callback_data: 'users:remove' }],
                [{ text: '📊 Profiles', callback_data: 'users:profiles' }, { text: '🔍 Status', callback_data: 'users:status' }],
                [{ text: '⬅️ Back', callback_data: 'process:start' }]
            ]
        };

        if (opts.editMessageId) {
            return this._safeEdit(chatId, opts.editMessageId, text, { parse_mode: 'Markdown', reply_markup });
        } else {
            await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup });
        }
    }

    async _handleStats(msg, opts = {}) {
        await this._sendStats(msg.chat.id, opts);
    }

    async _handleWhoAmI(msg) {
        const chatId = msg.chat.id;
        const uid = msg._uid || chatId;
        const { getDatabase } = require('../database');
        const db = await getDatabase();
        const user = await db.getUser(uid);

        if (!user) {
            return this.bot.sendMessage(chatId, "❓ *Identity Unknown*\nI haven't synced your record yet. Try sending a normal message first.", { parse_mode: 'Markdown' });
        }

        const isLinked = !!user.email || (user.uid && user.uid !== String(chatId));
        const role = user.role || 'user';
        const credits = (user.credits || 0).toFixed(2);

        let text = `👤 *Your Profile*\n`;
        text += `───────────────────\n`;
        text += `🆔 ID: \`${chatId}\`\n`;
        if (user.uid && user.uid !== String(chatId)) text += `🔗 Linked UID: \`${user.uid}\`\n`;
        text += `🏷 Name: *${user.fullname || user.firstName || 'Anonymous'}*\n`;
        text += `📧 Email: \`${user.email || 'Not linked'}\`\n`;
        text += `🎭 Role: \`${role.toUpperCase()}\`\n`;
        text += `💰 Credits: *$${credits}*\n`;
        text += `───────────────────\n`;

        if (!isLinked) {
            text += `\n💡 *Tip:* Use \`/link your@email.com\` to connect your web account.`;
        }

        const reply_markup = {
            inline_keyboard: [
                [{ text: '🔄 Refresh', callback_data: 'process:whoami' }],
                [{ text: '⬅️ Back', callback_data: 'process:start' }]
            ]
        };

        await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup });
    }

    async _handleLink(msg, match) {
        const chatId = msg.chat.id;
        const email = match?.[1]?.trim();

        if (!email) {
            return this.bot.sendMessage(chatId, "🔗 *Link Account*\nUsage: \`/link your@email.com\`\n\nThis connects your Telegram chat to your web-based wallet and vouchers.");
        }

        if (!email.includes('@')) {
            return this.bot.sendMessage(chatId, "❌ Invalid email format.");
        }

        const { getDatabase } = require('../database');
        const db = await getDatabase();

        try {
            this.bot.sendChatAction(chatId, 'typing');
            const result = await db.resolveFirebaseUser(email, {
                channel: 'telegram',
                channelId: String(chatId)
            });

            if (result) {
                // Link was successful (resolveFirebaseUser calls linkChannel internally if channel/channelId provided)
                await this.bot.sendMessage(chatId, `✅ *Account Linked!*\nWelcome back, *${result.fullname || 'User'}*.\nYour Telegram ID is now connected to \`${email}\`.`, { parse_mode: 'Markdown' });
                return this._handleWhoAmI(msg);
            } else {
                await this.bot.sendMessage(chatId, `❌ *User not found*\nWe couldn't find a web account with email \`${email}\`. Please register on our website first.`);
            }
        } catch (err) {
            logger.error(`Link error: ${err.message}`);
            await this.bot.sendMessage(chatId, `❌ *Linking failed*\n${err.message}`);
        }
    }

    async _handlePrinter(msg, match) {
        const chatId = msg.chat.id;
        const action = match?.[1];
        const value = match?.[2];

        const { getPrinterStatus, setPrinterModel, printTestPage } = require('../printer');

        if (!action) {
            const status = getPrinterStatus();

            // Mobile clients connected via WebSocket (Cordova BLE/USB)
            const mobile = PrintBroker.getInstance().getMobileClientStatus();
            const mobileLines = mobile.clients.map(c =>
                `  📱 \`${c.clientId}\` — ${c.capability.toUpperCase()} (${c.platform})`
            ).join('\n') || '  _None connected_';

            let text = `🖨 *Thermal Printer Settings*\n\n`;
            text += `📍 Port: \`${status.port || 'Auto'}\`\n`;
            text += `🏷 Model: \`${status.model || 'Generic'}\`\n`;
            text += `🔌 Interface: \`${status.interface || 'Serial'}\`\n`;
            text += `🚦 Server: ${status.ready ? '✅ Ready' : '❌ Offline/Error'}\n\n`;
            text += `📱 *Mobile Clients (BLE/USB):* ${mobile.count > 0 ? '✅ ' + mobile.count : '○ None'}\n`;
            text += mobileLines + '\n\n';
            text += `*Commands:*\n`;
            text += `• \`/printer model tmv88\` - Epson TM-V88\n`;
            text += `• \`/printer model pos58c\` - POS-58C (Generic 58mm)\n`;
            text += `• \`/printer test\` - Print test page\n`;
            text += `• \`/printer test mobile\` - Force mobile client test\n`;

            const reply_markup = {
                inline_keyboard: [
                    [{ text: '🔄 Refresh', callback_data: 'printer:status' }, { text: '📄 Test Page', callback_data: 'printer:test' }],
                    [{ text: '📱 Test Mobile', callback_data: 'printer:test_mobile' }, { text: '💻 Test Server', callback_data: 'printer:test_server' }],
                    [{ text: '🟦 TM-V88', callback_data: 'printer:set_tmv88' }, { text: '🟩 POS-58C', callback_data: 'printer:set_pos58c' }],
                    [{ text: '⬅️ Back', callback_data: 'process:start' }]
                ]
            };
            return this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup });
        }

        if (action === 'test') {
            const target = value?.toLowerCase();
            if (target === 'mobile') {
                await this.bot.sendMessage(chatId, '📱 Sending test job to mobile client...');
                const testVoucher = {
                    username: 'TEST-0000', password: 'TEST-0000',
                    profile: 'TestPage', loginUrl: 'http://hotspot.local/test',
                    price: 0, currency: 'USD'
                };
                const result = await PrintBroker.getInstance().print(testVoucher, { preferMobile: true });
                const via = result.via === 'mobile' ? '📱 Mobile (BLE/USB)' : '💻 Server';
                return this.bot.sendMessage(chatId,
                    result.success
                        ? `✅ Test page sent via ${via}!`
                        : `❌ Mobile test failed: ${result.error}\n_Hint: Open the app and ensure BLE/USB printer is connected._`,
                    { parse_mode: 'Markdown' }
                );
            }
            // Default: let printVoucher route (mobile-first → server fallback)
            await this.bot.sendMessage(chatId, '⏳ Sending test page to printer...');
            const ok = await printTestPage();
            return this.bot.sendMessage(chatId, ok ? '✅ Test page sent!' : '❌ Printing failed. Check connections.');
        }

        if (action === 'model') {
            if (!value) return this.bot.sendMessage(chatId, 'Usage: `/printer model <tmv88|pos58c>`');
            const model = value.toLowerCase();
            if (model !== 'tmv88' && model !== 'pos58c') return this.bot.sendMessage(chatId, '❌ Unsupported model. Use `tmv88` or `pos58c`.');
            setPrinterModel(model);
            return this.bot.sendMessage(chatId, `✅ Printer model set to *${model.toUpperCase()}*.`, { parse_mode: 'Markdown' });
        }
    }


    async _handleVoucher(msg, match, opts = {}) {
        const chatId = msg.chat.id;
        const planId = typeof match === 'string' ? match : match?.[1];  // set if called as /voucher <planId>

        const { getDatabase } = require('../database');
        const db = await getDatabase();
        const uid = msg._uid || chatId;
        const user = await db.getUser(uid);
        const isAdmin = user?.role === 'admin' || user?.role === 'reseller';

        if (planId && typeof planId === 'string') {
            return this._createVoucher(chatId, planId);
        }
        
        // ── Build plan picker dynamically from DB / config ────────────────────
        try {
            let plans = await db.getPlans(true); // active only

            // Fallback to defaults if no plans found
            if (!plans.length) {
                const { getConfig } = require('../config');
                const cfg = getConfig();
                plans = Array.isArray(cfg.plans) ? cfg.plans.filter(p => p.active !== false) : [];
            }

            if (!plans.length) {
                plans = [
                    { name: '1 Hour', mikrotikProfile: '1Hour', durationValue: 1, durationUnit: 'hours', price: 0.50, deviceLimit: 1 },
                    { name: '1 Day', mikrotikProfile: '1Day', durationValue: 1, durationUnit: 'days', price: 1.0, deviceLimit: 1 },
                    { name: '7 Days', mikrotikProfile: '7Day', durationValue: 7, durationUnit: 'days', price: 3.0, deviceLimit: 1 },
                    { name: '30 Days', mikrotikProfile: '30Days', durationValue: 30, durationUnit: 'days', price: 5.0, deviceLimit: 1 },
                ];
            }

            const uid = msg._uid || chatId;
            const wallet = await db.getWallet(uid);
            const balance = wallet.balance || 0;
            const currency = wallet.currency || 'USD';

            // Build inline keyboard — 1 plan per row with full detail
            const rows = plans.map(p => {
                const dur = p.durationValue && p.durationUnit
                    ? `${p.durationValue}${p.durationUnit[0]}`   // e.g. "1h", "7d"
                    : '∞';
                const devs = p.deviceLimit ? `${p.deviceLimit}📱` : '1📱';
                const priceStr = (p.price > 0) ? `${p.price} ${currency}` : (isAdmin ? 'Free' : '0');
                return [{ text: `🎫 ${p.name}  ·  ${dur}  ·  ${devs}  ·  ${priceStr}`, callback_data: `voucher:${p.mikrotikProfile || p.id || p.name}` }];
            });

            // Admin: Bulk Create shortcut
            if (isAdmin) {
                rows.push([{ text: '📦 Bulk Create (Admin)', callback_data: 'bulk:pick' }]);
                rows.push([{ text: '🐞 Debug Vouchers', callback_data: 'process:voucher_debug' }]);
            }
            rows.push([{ text: '⬅️ Back', callback_data: 'process:start' }]);

            const text = `🎫 *Create Voucher*\n\n` +
                `Account: *${isAdmin ? 'Admin (Free)' : 'User'}*\n` +
                `Balance: *${balance} ${currency}*\n\n` +
                `Select a plan to purchase:`;

            if (opts.editMessageId) {
                await this._safeEdit(chatId, opts.editMessageId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
            } else {
                await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
            }
        } catch (err) {
            await this.bot.sendMessage(chatId, `❌ Could not load plans: ${err.message}`);
        }
    }

    async _handleVoucherList(msg, opts = {}) {
        const chatId = msg.chat.id;
        const { getDatabase } = require('../database');
        const db = await getDatabase();
        
        try {
            const vouchers = await db.getVouchers(10); // last 10
            if (!vouchers || !vouchers.length) {
                const noText = '🎫 No recent vouchers found.';
                if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, noText);
                return this.bot.sendMessage(chatId, noText);
            }

            let text = `🎫 *Recent Vouchers*\n\n`;
            const keyboard = [];

            vouchers.forEach(v => {
                const code = v.code || v.id;
                const used = v.used ? '✅' : '⏳';
                text += `${used} \`${code}\` — ${v.planName || v.plan || 'default'}\n`;
                keyboard.push([
                    { text: `🖨 Print ${code}`, callback_data: `print:${code}` },
                    { text: `✏️ Plan`, callback_data: `vupdate:${code}` }
                ]);
            });

            keyboard.push([{ text: '🔙 Back', callback_data: 'process:voucher' }]);

            if (opts.editMessageId) {
                await this._safeEdit(chatId, opts.editMessageId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
            } else {
                await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
            }
        } catch (err) {
            await this.bot.sendMessage(chatId, `❌ Failed to list vouchers: ${err.message}`);
        }
    }

    async _handleReprint(msg) {
        const chatId = msg.chat.id;
        const { getDatabase } = require('../database');
        const db = await getDatabase();
        
        try {
            const last = await db.getVouchers(1);
            if (!last || !last.length) throw new Error('No vouchers found to reprint');
            
            const v = last[0];
            const code = v.code || v.id;
            
            await this.bot.sendMessage(chatId, `🖨 *Reprinting last voucher:* \`${code}\`...`, { parse_mode: 'Markdown' });
            
            const voucherData = {
                username: code,
                password: code,
                profile: v.planName || v.plan,
                loginUrl: v.loginUrl || `http://hotspot.local/login?username=${code}`,
                expires: v.expiresAt,
                price: v.value,
                currency: v.currency,
                duration: v.durationValue ? `${v.durationValue}${v.durationUnit === 'hours' ? 'h' : v.durationUnit === 'days' ? 'd' : v.durationUnit === 'weeks' ? 'w' : ''}` : undefined
            };

            const result = await PrintBroker.getInstance().print(voucherData);
            const via = result.via === 'mobile' ? '📱 mobile (BLE/USB)' : '💻 server';

            if (result.success) {
                await this.bot.sendMessage(chatId, `✅ Print job sent via ${via}.`);
            } else {
                await this.bot.sendMessage(chatId, `❌ Print failed (${via}): ${result.error}`);
            }
        } catch (err) {
            await this.bot.sendMessage(chatId, `❌ Reprint failed: ${err.message}`);
        }
    }

    async _handleMistakes(msg) {
        const chatId = msg.chat.id;
        const rl = msg._rl || this._checkRateLimit(chatId);
        const seconds = Math.ceil((rl.resetTime - Date.now()) / 1000);
        const text = `🛡 *Quota Status*\nYou have *${rl.remaining} mistakes* (actions) available in this window.\nReset in ${seconds}s.`;
        await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    }

    async _handleVoucherDebug(msg, opts = {}) {
        const chatId = msg.chat.id;
        const { getDatabase } = require('../database');
        const db = await getDatabase();
        const user = await db.getUser(chatId);
        const isAdmin = user?.role === 'admin' || user?.role === 'reseller';

        if (!isAdmin) {
            const errText = "❌ Unauthorized";
            if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, errText);
            return this.bot.sendMessage(chatId, errText);
        }

        const fs = require('fs');
        const { BRAND, getConfig } = require('../config');

        let report = `🔍 *${BRAND?.name || 'System'} Voucher Diagnostics*\n\n`;
        try {
            // 1. Config Check
            const config = getConfig();
            report += `*Config:*\n` +
                `  Format: \`${config.vouchers?.prefix || 'STAR'}-${config.vouchers?.format || 'XXXX-XXXX'}\`\n\n`;

            // 2. Database Check
            const stats = await db.getStats();
            report += `*Database:*\n` +
                `  Type: ${db.db ? 'Firebase' : 'Local SQLite/JSON'}\n` +
                `  Count: ${stats.total || 0} total, ${stats.active || 0} active\n\n`;

            // 3. Generation Dry-run
            const voucherAgent = require('../voucher');
            const testCode = await voucherAgent.generate('default');
            report += `*Dry-run:*\n` +
                `  Status: ✅ PASSED\n` +
                `  Sample: \`${testCode}\`\n\n`;

            report += `✅ *Voucher system is healthy*`;
        } catch (error) {
            report += `❌ *Diagnostic Failed:*\n${error.message}\n`;
        }

        const reply_markup = { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'process:voucher' }]] };

        if (opts.editMessageId) {
            await this._safeEdit(chatId, opts.editMessageId, report, { parse_mode: 'Markdown', reply_markup });
        } else {
            await this.bot.sendMessage(chatId, report, { parse_mode: 'Markdown', reply_markup });
        }
    }

    async _handleKick(msg, match, opts = {}) {
        const chatId = msg.chat.id;
        const username = match?.[1];
        if (!username) {
            const errText = '❌ Usage: /kick <username>';
            if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, errText);
            return this.bot.sendMessage(chatId, errText);
        }
        await this._doKick(chatId, username, opts);
    }

    async _handleReboot(msg, opts = {}) {
        const chatId = msg.chat.id;
        this.pendingReboots.add(chatId);
        const text = '⚠️ *Confirm System Reboot?*\nAll users will be disconnected.';
        const options = {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ Yes, reboot', callback_data: 'confirm:reboot' },
                    { text: '❌ Cancel', callback_data: 'confirm:cancel' }
                ]]
            }
        };

        if (opts.editMessageId) {
            await this._safeEdit(chatId, opts.editMessageId, text, options);
        } else {
            await this.bot.sendMessage(chatId, text, options);
        }
    }

    async _handleMenu(msg, opts = {}) {
        const chatId = msg.chat.id;
        const text = `🤖 *AgentOS Commands*\n\n` +
            `/start — Main menu\n` +
            `/dashboard — System overview\n` +
            `/users — Active sessions\n` +
            `/stats — Router stats\n` +
            `/voucher [plan] — Create voucher\n` +
            `/vouchers — List recent vouchers\n` +
            `/reprint — Reprint last voucher\n` +
            `/kick <user> — Disconnect user\n` +
            `/reboot — Router reboot\n` +
            `/pay — Payment / billing\n` +
            `/ping [host] — Ping\n` +
            `/help — This message`;

        if (opts.editMessageId) {
            await this._safeEdit(chatId, opts.editMessageId, text, { parse_mode: 'Markdown' });
        } else {
            await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        }
    }

    async _handleHelp(msg, match, opts = {}) {
        await this._handleMenu(msg, opts);
    }

    async _handlePing(msg, match, opts = {}) {
        const chatId = msg.chat.id;
        const host = match?.[1];
        if (!host) {
            return this.promptUser(chatId, '📡 *Ping*\nPlease enter the target IP or host:', 'tool:ping');
        }
        if (!this.mikrotik) {
            const errText = '⚠️ MikroTik not connected.';
            if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, errText);
            return this.bot.sendMessage(chatId, errText);
        }

        const startText = `📡 Pinging ${host}...`;
        if (opts.editMessageId) await this._safeEdit(chatId, opts.editMessageId, startText);
        else await this.bot.sendMessage(chatId, startText);

        try {
            const result = await this.mikrotik.executeTool('ping', { host, count: 4 });
            const text = `✅ *Ping ${host}*\n\n${JSON.stringify(result, null, 2)}`;
            const options = {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to Network', callback_data: 'process:network' }]] }
            };
            if (opts.editMessageId) await this._safeEdit(chatId, opts.editMessageId, text, options);
            else await this.bot.sendMessage(chatId, text, options);
        } catch (err) {
            const errText = `❌ Ping failed: ${err.message}`;
            if (opts.editMessageId) await this._safeEdit(chatId, opts.editMessageId, errText);
            else await this.bot.sendMessage(chatId, errText);
        }
    }


    async _handleDahua(msg, match) {
        const chatId = msg.chat.id;
        const args = match?.[1]?.trim().split(/\s+/) || [];
        const action = args[0] || 'list';
        const device = args[1];

        try {
            if (!this.agent) throw new Error('Agent not initialized');

            if (action === 'menu') {
                return this._sendDahuaMenu(chatId);
            }

            await this.bot.sendMessage(chatId, `📹 *Dahua Control*\nExecuting: \`${action}\`...`, { parse_mode: 'Markdown' });

            let toolName, toolArgs;

            if (action === 'list') {
                toolName = 'dahua.device.list';
                toolArgs = {};
            } else if (action === 'snapshot') {
                toolName = 'dahua.snapshot.get';
                toolArgs = { device };
            } else if (action === 'reboot') {
                toolName = 'dahua.system.reboot';
                toolArgs = { device, reason: 'Manual reboot via Telegram' };
            } else if (action === 'info') {
                toolName = 'dahua.device.info';
                toolArgs = { device };
            } else if (action === 'channels') {
                toolName = 'dahua.device.channels';
                toolArgs = { device };
            } else if (action === 'stream') {
                toolName = 'dahua.stream.url';
                toolArgs = { device: args[1] && isNaN(args[1]) ? args[1] : undefined, channel: Number(args[2] || args[1]) || 1 };
            } else if (action === 'snapshotall') {
                toolName = 'dahua.snapshot.getAll';
                toolArgs = { device };
            } else if (action === 'search') {
                toolName = 'dahua.events.search';
                toolArgs = { query: args.slice(1).join(' ') };
            } else if (action === 'summarize' || action === 'ask') {
                toolName = 'dahua.events.summarize';
                toolArgs = { query: args.slice(1).join(' ') };
            } else if (action === 'describe') {
                toolName = 'dahua.scene.describe';
                toolArgs = { device: args[1] && isNaN(args[1]) ? args[1] : undefined, channel: Number(args[2] || args[1]) || 1 };
            } else {
                return this.bot.sendMessage(chatId, `❌ Unknown action: ${action}. Use list, snapshot, snapshotall, channels, stream, info, reboot, search, summarize, describe, menu.`);
            }

            const result = await this.agent.executeTool(toolName, toolArgs, { userId: msg.from.id, channel: 'telegram' });

            if (action === 'list') {
                let text = `✅ *Dahua Devices*\n\n`;
                result.forEach((dev, i) => {
                    text += `${i + 1}. *${dev.name}* (\`${dev.id}\`)\n   🌐 ${dev.host} | 🏎 ${dev.driver}\n`;
                });
                await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
            } else if (action === 'snapshot') {
                if (result.base64) {
                    const imgBuffer = Buffer.from(result.base64, 'base64');
                    await this.bot.sendPhoto(chatId, imgBuffer, { caption: `📷 Snapshot from ${result.device || device || 'default'}` });
                } else {
                    await this.bot.sendMessage(chatId, `❌ Snapshot failed: No data returned`);
                }
            } else if (action === 'snapshotall') {
                for (const shot of result) {
                    if (shot.base64) {
                        await this.bot.sendPhoto(chatId, Buffer.from(shot.base64, 'base64'), { caption: `📷 Ch ${shot.channel} — ${shot.name}` });
                    } else {
                        await this.bot.sendMessage(chatId, `❌ Ch ${shot.channel} (${shot.name}): ${shot.error}`);
                    }
                }
            } else if (action === 'channels') {
                const text = `✅ *Channels*\n\n` + result.map(c => `${c.channel}. ${c.name}`).join('\n');
                await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
            } else if (action === 'stream') {
                await this.bot.sendMessage(chatId, `🎥 <b>Live Stream (channel ${result.channel})</b>\n\nMain: ${spoiler(result.main)}\nSub: ${spoiler(result.sub)}\n\n<i>Tap to reveal, then open with VLC or an RTSP-capable player.</i>`, { parse_mode: 'HTML' });
            } else if (action === 'search') {
                const lines = result.events.map(e => `${e.time}  [${e.device}]  ${e.code}${e.channel ? ` ch${e.channel}` : ''}`);
                await this.bot.sendMessage(chatId, `🔍 *${result.count} event(s)*${result.truncated ? ' (showing most recent 100)' : ''}\n\n${lines.join('\n') || 'Nothing found.'}`, { parse_mode: 'Markdown' });
            } else if (action === 'summarize' || action === 'ask') {
                const conf = (result.confidence ?? null) !== null ? ` · confidence ${result.confidence}%` : '';
                await this.bot.sendMessage(chatId, `🤖 *Summary* _(via ${result.provider || 'n/a'}${conf})_\n\n${result.summary}`, { parse_mode: 'Markdown' });
            } else if (action === 'describe') {
                const conf = (result.confidence ?? null) !== null ? ` · confidence ${result.confidence}%` : '';
                await this.bot.sendMessage(chatId, `👁️ *${result.device} — Channel ${result.channel}* _(via ${result.provider}${conf})_\n\n${result.summary}`, { parse_mode: 'Markdown' });
            } else {
                await this.bot.sendMessage(chatId, `✅ Success:\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``, { parse_mode: 'Markdown' });
            }
        } catch (err) {
            logger.error('TelegramChannel Dahua error:', err);
            await this.bot.sendMessage(chatId, `❌ Dahua error: ${err.message}`);
        }
    }

    /**
     * Proactive control panel (vs. the reactive buttons attached to alert messages) — lets the
     * user configure alerts on/off, jump to voucher/user creation (reusing the existing
     * process:voucher flow — same MikroTik voucher system, one panel for both), reboot a camera,
     * or search events, without waiting for an alert to fire first.
     */
    async _sendDahuaMenu(chatId, opts = {}) {
        const notifier = this.agent && this.agent.dahuaNotifier;
        const alertsOn = notifier ? notifier.enabled !== false : null;
        const deviceList = await this.agent.executeTool('dahua.device.list', {}, { userId: chatId, channel: 'telegram' }).catch(() => []);
        const devices = deviceList.map(d => d.id);

        const deviceRows = devices.map(id => ([
            { text: `📷 ${id}`, callback_data: `dahua:devmenu:${id}` }
        ]));

        const reply_markup = {
            inline_keyboard: [
                alertsOn === null ? [] : alertsOn
                    ? [{ text: '🔕 Turn Alerts OFF', callback_data: 'dahua:alertsoff' }]
                    : [{ text: '🔔 Turn Alerts ON', callback_data: 'dahua:alertson' }],
                ...deviceRows,
                [{ text: '🎫 Add User / Voucher', callback_data: 'process:voucher' }],
                [{ text: '🔍 Search Events', callback_data: 'dahua:searchprompt' }]
            ].filter(row => row.length)
        };

        const text = `📹 *Dahua Control Panel*\n\nAlerts: ${alertsOn === null ? 'notifier not running' : alertsOn ? '🔔 ON' : '🔕 OFF'}\nDevices: ${devices.join(', ') || 'none configured'}`;

        if (opts.editMessageId) {
            return this._safeEdit(chatId, opts.editMessageId, text, { parse_mode: 'Markdown', reply_markup });
        }
        await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup });
    }

    /** Persists the alerts toggle so it survives a gateway restart (the live notifier is toggled separately, in memory). */
    _persistNotifyEnabled(enabled) {
        try {
            const { CONFIG_PATH } = require('../config');
            if (!fs.existsSync(CONFIG_PATH)) return;
            const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            cfg.adapters = cfg.adapters || {};
            cfg.adapters.cctv = cfg.adapters.cctv || {};
            cfg.adapters.cctv.notify = cfg.adapters.cctv.notify || {};
            cfg.adapters.cctv.notify.enabled = enabled;
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
        } catch (e) {
            logger.warn(`TelegramChannel: failed to persist notify.enabled: ${e.message}`);
        }
    }

    async _handleClaim(msg) {
        const chatId = msg.chat.id.toString();
        if (this.config.allowed_ids && this.config.allowed_ids.length > 0) {
            return this.bot.sendMessage(chatId, '❌ Admin already claimed.');
        }

        this.config.allowed_ids = [chatId];
        logger.info(`TelegramChannel: Chat ${chatId} claimed admin.`);

        await this.bot.sendMessage(chatId,
            `🎉 *Success!* You are now the primary admin (\`${chatId}\`).\n` +
            `Commands are now strictly restricted to you.\n\n` +
            `> [!IMPORTANT]\n` +
            `> Please update your config with \`allowed_ids: ["${chatId}"]\` to persist this.`
            , { parse_mode: 'Markdown' });
    }

    async _handleLink(msg, match) {
        const chatId = msg.chat.id;
        const input = match?.[1]?.trim();

        if (!input) {
            return this.bot.sendMessage(chatId,
                '🔗 *Link Account*\nGenerate a code on the website (Settings → Link Chat Account), then send:\n`/link <code>`\n\nOr link by email: `/link your@email.com`\nOr by phone (if verified via Phone sign-in on the website): `/link +27821234567`',
                { parse_mode: 'Markdown' });
        }

        try {
            if (/^\d{6}$/.test(input)) {
                const { verifyLinkCode } = await import('./link-verifier.js');
                const result = await verifyLinkCode(input, 'telegram', chatId);
                await this.bot.sendMessage(chatId, result.message, { parse_mode: 'Markdown' });
                if (result.ok) return this._handleWhoAmI(msg);
                return;
            }

            // resolveFirebaseUser auto-detects email vs phone (+countrycode
            // or 7-15 digits) vs raw uid shape — no need to branch on it here.
            const { getDatabase } = require('../database');
            const db = await getDatabase();
            const result = await db.resolveFirebaseUser(input, { channel: 'telegram', channelId: chatId });
            if (result) {
                await this.bot.sendMessage(chatId,
                    `✅ *Account Linked!*\nWelcome, *${result.fullname || 'User'}*. Your Telegram is now connected to your web account.`,
                    { parse_mode: 'Markdown' });
                return this._handleWhoAmI(msg);
            }
            return this.bot.sendMessage(chatId, "❌ *User not found*\nWe couldn't find a web account matching that. Try your email, verified phone number (with country code), or the 6-digit code from the website.");
        } catch (err) {
            logger.error(`Telegram link error: ${err.message}`);
            await this.bot.sendMessage(chatId, `❌ Linking failed: ${err.message}`);
        }
    }

    async _handleToken(msg) {
        const chatId = msg.chat.id;
        const gatewayToken = process.env.GATEWAY_TOKEN || 'Not set';
        await this.bot.sendMessage(chatId,
            `🔑 *Gateway Token*\n\n\`${gatewayToken}\`\n\n` +
            `Use this for WebSocket or API Authorization. Keep it secret!`,
            { parse_mode: 'Markdown' }
        );
    }

    async _handleAsk(msg, match) {
        const chatId = msg.chat.id;
        const query = match[1];
        await this._processAI(chatId, query, msg);
    }

    async _handleCli(msg, match) {
        const chatId = msg.chat.id;
        const cmd = match[1];
        if (!this.mikrotik) return this.bot.sendMessage(chatId, '⚠️ MikroTik not connected.');

        await this.bot.sendChatAction(chatId, 'typing');
        try {
            const res = await this.mikrotik.executeCLI(cmd);
            await this.bot.sendMessage(chatId, `💻 *CLI:*\n\`\`\`text\n${this._truncate(res, 3900)}\n\`\`\``, { parse_mode: 'Markdown' });
        } catch (err) {
            await this.bot.sendMessage(chatId, `❌ CLI Error: ${err.message}`);
        }
    }

    async _handleApi(msg, match) {
        const chatId = msg.chat.id;
        const cmd = match[1];
        if (!this.mikrotik) return this.bot.sendMessage(chatId, '⚠️ MikroTik not connected.');

        await this.bot.sendChatAction(chatId, 'typing');
        try {
            const res = await this.mikrotik.executeRawAPI(cmd);
            await this.bot.sendMessage(chatId, `⚙️ *API:*\n\`\`\`json\n${this._truncate(JSON.stringify(res, null, 2), 3900)}\n\`\`\``, { parse_mode: 'Markdown' });
        } catch (err) {
            await this.bot.sendMessage(chatId, `❌ API Error: ${err.message}`);
        }
    }

    async _handleTools(msg, opts = {}) {
        const chatId = msg.chat.id;
        if (!this.mikrotik) return this.bot.sendMessage(chatId, '⚠️ MikroTik not connected.');

        try {
            const tools = await this.mikrotik.getAvailableTools();
            const btns = tools.map(t => ({ text: `🔧 ${t}`, callback_data: `tool:${t}` }));
            const rows = [];
            for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
            rows.push([{ text: '🔙 Back', callback_data: 'process:start' }]);

            const text = '*Available Tools*';
            const reply_markup = { inline_keyboard: rows };

            if (opts.editMessageId) {
                return this._safeEdit(chatId, opts.editMessageId, text, { parse_mode: 'Markdown', reply_markup });
            } else {
                await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup });
            }
        } catch (err) {
            await this.bot.sendMessage(chatId, `❌ Failed to list tools: ${err.message}`);
        }
    }

    async _handleTool(msg, match, opts = {}) {
        const chatId = msg.chat.id;
        let toolName = match[1];
        const paramsStr = match[2] || '';

        if (toolName === 'add.user') toolName = 'user.add';

        if (!this.mikrotik) {
            const errText = '⚠️ MikroTik not connected.';
            if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, errText);
            return this.bot.sendMessage(chatId, errText);
        }

        try {
            const params = paramsStr.trim() ? paramsStr.split(/\s+/) : [];

            // Handle missing parameters with interactive prompts
            if (toolName === 'user.add') {
                if (params.length < 3) {
                    return this.promptUser(chatId, '➕ *Add User*\nPlease enter: `username password plan`\nExample: `john secret123 1day`', `tool:user.add`);
                }
                const [username, password, plan] = params;
                await this.mikrotik.addHotspotUser(username, password, plan);
                const text = `✅ User *${username}* added successfully with plan *${plan}*.`;
                const options = {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to Users', callback_data: 'process:users' }]] }
                };
                if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, text, options);
                return this.bot.sendMessage(chatId, text, options);
            }
            if (toolName === 'user.remove' || toolName === 'user.kick' || toolName === 'user.status') {
                if (params.length < 1) return this.promptUser(chatId, `👤 *${toolName}*\nPlease enter the username:`, `tool:${toolName}`);
            }
            if (toolName === 'ping' || toolName === 'traceroute' || toolName === 'flood') {
                if (params.length < 1) return this.promptUser(chatId, `🌐 *${toolName}*\nPlease enter the target IP or host:`, `tool:${toolName}`);
            }
            if (toolName === 'firewall.block' || toolName === 'firewall.unblock') {
                if (params.length < 1) return this.promptUser(chatId, `🛡️ *${toolName}*\nPlease enter the IP address:`, `tool:${toolName}`);
            }

            const result = await this.mikrotik.executeTool(toolName, ...params);

            const formattedRes = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);

            const text = `✅ *${toolName}*\n\`\`\`text\n${this._truncate(formattedRes, 3800)}\n\`\`\``;
            const options = {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to Tools', callback_data: 'process:tools' }]] }
            };
            if (opts.editMessageId) await this._safeEdit(chatId, opts.editMessageId, text, options);
            else await this.bot.sendMessage(chatId, text, options);
        } catch (err) {
            const errText = `❌ Tool Error: ${err.message}`;
            const options = {
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to Tools', callback_data: 'process:tools' }]] }
            };
            if (opts.editMessageId) await this._safeEdit(chatId, opts.editMessageId, errText, options);
            else await this.bot.sendMessage(chatId, errText, options);
        }
    }

    async _handleSetupRouter(msg) {
        const chatId = msg.chat.id;
        this.promptUser(chatId, '🌐 *Step 1: Router IP*\nPlease enter the IP address of your MikroTik (e.g., `192.168.88.1`):', 'setup:ip');
    }

    promptUser(chatId, text, action) {
        this.pendingInputs.set(chatId, { action });
        this.bot.sendMessage(chatId, text, {
            reply_markup: { force_reply: true, selective: true },
            parse_mode: 'Markdown',
        });
    }

    async _executePending(chatId, input, action) {
        try {
            await this.bot.sendChatAction(chatId, 'typing');
            switch (action) {
                case 'setup:ip':
                    this.promptUser(chatId, `👤 *Step 2: Username*\nIP: \`${input}\` set. Enter MikroTik user:`, `setup:user:${input}`);
                    break;
                default: {
                    if (action.startsWith('setup:user:')) {
                        const ip = action.split(':')[2];
                        this.promptUser(chatId, `🔑 *Step 3: Password*\nUser: \`${input}\` set. Enter MikroTik password:`, `setup:pass:${ip}:${input}`);
                        break;
                    }
                    if (action.startsWith('setup:pass:')) {
                        const [, , ip, user] = action.split(':');
                        await this._finishSetup(chatId, ip, user, input);
                        break;
                    }
                    if (action.startsWith('tool:')) {
                        const toolName = action.substring(5); // e.g. "user.add"
                        await this._handleTool({ chat: { id: chatId } }, [null, toolName, input]);
                        break;
                    }
                    if (action === 'users:doedit') {
                        // Generic edit: input = "username [password] [profile]"
                        await this._doEditUser(chatId, input);
                        break;
                    }
                    if (action.startsWith('users:doeditnamed:')) {
                        // Per-user edit: username pre-filled, input = "[password] [profile]"
                        const username = action.substring('users:doeditnamed:'.length);
                        await this._doEditUser(chatId, input, username);
                        break;
                    }
                    break;
                }
            }
        } catch (err) {
            await this.bot.sendMessage(chatId, `❌ Failed: ${err.message}`);
        }
    }

    async _finishSetup(chatId, host, user, pass) {
        await this.bot.sendMessage(chatId, '⚙️ `[ Attempting connection... ]`', { parse_mode: 'Markdown' });
        try {
            if (!this.mikrotik) throw new Error('MikroTik service not available');
            await this.mikrotik.connect({ host, user, pass });
            await this.bot.sendMessage(chatId, '✅ *Setup Successful!*\nRouter is connected.', { parse_mode: 'Markdown' });
        } catch (e) {
            await this.bot.sendMessage(chatId, `❌ *Setup Failed:* ${e.message}`, { parse_mode: 'Markdown' });
        }
    }

    async _handleNaturalLanguage(msg) {
        const chatId = msg.chat.id;
        const text = msg.text;

        // ── Email Identity Capture ──────────────────────────────────────────
        // Detect email addresses in the message text to link channel to identity.
        const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi;
        const emails = text.match(emailRegex);
        if (emails && emails.length > 0) {
            const email = emails[0].toLowerCase();
            const { getDatabase } = require('../database');
            const db = await getDatabase();
            
            // Trigger an upsert that will link the email to this chatId/UID
            await db.upsertUser(String(chatId), {
                email,
                platform: 'telegram',
                lastSeen: new Date().toISOString()
            }).catch(e => logger.warn(`[Telegram] Email capture sync failed: ${e.message}`));
            
            logger.info(`[Telegram] Captured email ${email} from ${chatId}`);
        }

        // Pending reboot confirmation via free text
        if (this.pendingReboots.has(chatId)) {
            this.pendingReboots.delete(chatId);
            if (text.trim().toUpperCase() === 'YES') {
                await this._doReboot(chatId);
            } else {
                await this.bot.sendMessage(chatId, '❌ Reboot cancelled.');
            }
            return;
        }

        await this._processAI(chatId, text, msg);
    }

    /**
     * Escape text for Telegram MarkdownV2 so unbalanced/special chars never
     * cause a silent 400 rejection.
     */
    _escapeMd(text) {
        // MarkdownV2 special chars that must be escaped outside code spans
        return String(text).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
    }

    /** Split a long string into chunks ≤ maxLen chars on newline boundaries */
    _splitMessage(text, maxLen = 4000) {
        if (text.length <= maxLen) return [text];
        const chunks = [];
        let remaining = text;
        while (remaining.length > maxLen) {
            let cut = remaining.lastIndexOf('\n', maxLen);
            if (cut < 1) cut = maxLen;
            chunks.push(remaining.slice(0, cut));
            remaining = remaining.slice(cut).trimStart();
        }
        if (remaining) chunks.push(remaining);
        return chunks;
    }

    async _processAI(chatId, text, msg) {
        this.bot.sendChatAction(chatId, 'typing').catch(() => { });

        try {
            if (this.agent && typeof this.agent.processInteraction === 'function') {
                const result = await this.agent.processInteraction({ text }, {
                    userId: msg._uid || msg.from.id,
                    platformId: msg.from.id,
                    userDoc: msg.userDoc,
                    username: msg.from.username,
                    channel: 'telegram',
                    channelId: chatId
                });

                // Safe reply extraction — never send raw JSON blobs
                let reply = result?.result?.text || result?.text || result?.message || null;
                if (!reply || typeof reply !== 'string') {
                    reply = '🤖 I processed your request. Use /menu for available commands.';
                }

                // Send in plain text mode to avoid Markdown parse failures.
                // The AI response may contain arbitrary characters that break MarkdownV2.
                const chunks = this._splitMessage(reply, 4000);
                for (const chunk of chunks) {
                    await this.bot.sendMessage(chatId, chunk).catch(async (sendErr) => {
                        // If plain send fails, log and send a short error notice
                        logger.error(`[Telegram] sendMessage failed: ${sendErr.message}`, { chatId });
                        await this.bot.sendMessage(chatId, '⚠️ Failed to send response. Try /menu for commands.').catch(() => {});
                    });
                }
            } else {
                await this.bot.sendMessage(chatId,
                    `🤖 I received: "${text}"\n\nUse /menu for available commands.`
                );
            }
        } catch (err) {
            logger.error('TelegramChannel AI error:', err);
            await this.bot.sendMessage(chatId,
                '⚠️ AI processing error. Use /menu for manual commands.'
            ).catch(() => {});
        }
    }

    // ── Callback router ───────────────────────────────────────────────────────

    async _handleCallback(query) {
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const data = query.data;

        await this.bot.answerCallbackQuery(query.id).catch(() => { });

        const parts = data.split(':');
        const category = parts[0];
        const action = parts[1];
        const extra = parts.slice(2).join(':');

        switch (category) {
            case 'process':
            case 'action':
            case 'cmd':
                await this._dispatchProcessButton(chatId, messageId, action, query);
                break;
            case 'net':
                await this._dispatchNetButton(chatId, messageId, action, query);
                break;
            case 'users':
                await this._dispatchUsersButton(chatId, messageId, action, query);
                break;
            case 'tool':
                // For tools, action is the tool name, extra might be params
                await this._handleTool(query.message, [null, action, extra], { editMessageId: messageId });
                break;
            case 'health':
                await this._sendHealth(chatId, { editMessageId: messageId });
                break;
            case 'logs':
                await this._sendLogs(chatId, { editMessageId: messageId });
                break;
            case 'neighbors':
                await this._sendNeighbors(chatId, { editMessageId: messageId });
                break;
            case 'trace':
                await this._handleTraceroute(query.message, null, { editMessageId: messageId });
                break;
            case 'kick':
                await this._doKick(chatId, action, { editMessageId: messageId });
                break;
            case 'confirm':
                if (action === 'reboot') await this._doReboot(chatId, { editMessageId: messageId });
                else if (action === 'cancel') {
                    const cancelText = '❌ Action cancelled.';
                    if (messageId) await this._safeEdit(chatId, messageId, cancelText);
                    else await this.bot.sendMessage(chatId, cancelText);
                }
                break;
            case 'wallet':
                await this._handleWallet(query.message, { editMessageId: messageId });
                break;
            case 'pay':
                // For payment, action is method, extra is plan
                await this._handlePayAction(chatId, action, extra, { editMessageId: messageId });
                break;
            case 'voucher':
                await this._createVoucher(chatId, action, messageId);
                break;
            case 'bulk':
                await this._handleBulkVoucher(chatId, action, extra, messageId, query);
                break;
            case 'print':
                await this._handlePrintCallback(chatId, action, messageId);
                break;
            case 'vupdate':
                await this._handleVupdateCallback(chatId, action, extra, messageId);
                break;
                        case 'reprint':
                await this._handleReprint({ chat: { id: chatId } });
                break;
            case 'dahua':
                await this._handleDahuaCallback(chatId, action, extra, messageId, query);
                break;
            case 'shop':
                await this._handleShopCallback(chatId, action, extra, messageId, query);
                break;
        }
    }

    async _handleDahuaCallback(chatId, action, deviceAndCh, _messageId, _query) {
        const [deviceId, chStr] = (deviceAndCh || '').split(':');
        const ch = parseInt(chStr) || 1;
        if (action === 'dismiss') { await this.bot.sendMessage(chatId, 'Alert dismissed.').catch(() => {}); return; }
        await this.bot.sendChatAction(chatId, 'typing').catch(() => {});
        const toolCtx = { userId: chatId, channel: 'telegram' };
        try {
            if (action === 'snap') {
                const r = await this.agent.executeTool('dahua.snapshot.get', { device: deviceId, channel: ch }, toolCtx);
                if (r && r.base64) await this.bot.sendPhoto(chatId, Buffer.from(r.base64, 'base64'), { caption: `Snapshot ${deviceId} ch${ch}` });
                else await this.bot.sendMessage(chatId, 'No snapshot data.');
            } else if (action === 'stream') {
                const r = await this.agent.executeTool('dahua.stream.url', { device: deviceId, channel: ch }, toolCtx);
                await this.bot.sendMessage(chatId, `🎥 <b>Stream ${escapeHtml(deviceId)} ch${ch}</b>\nMain: ${spoiler(r.main)}\nSub: ${spoiler(r.sub)}\n<i>Tap to reveal, then open with VLC.</i>`, { parse_mode: 'HTML' });
            } else if (action === 'snapall') {
                const rs = await this.agent.executeTool('dahua.snapshot.getAll', { device: deviceId }, toolCtx);
                for (const s of rs) {
                    if (s.base64) await this.bot.sendPhoto(chatId, Buffer.from(s.base64, 'base64'), { caption: `Ch${s.channel} ${s.name || deviceId}` });
                    else await this.bot.sendMessage(chatId, `Ch${s.channel}: ${s.error}`);
                }
            } else if (action === 'mute') {
                const notifier = this.agent && this.agent.dahuaNotifier;
                if (notifier) {
                    notifier.muteChannel(deviceId, ch, 60 * 60 * 1000);
                    await this.bot.sendMessage(chatId, `Muted ${deviceId} ch${ch} for 1h.`);
                } else {
                    await this.bot.sendMessage(chatId, 'No notifier running — cannot mute.');
                }
            } else if (action === 'info') {
                const r = await this.agent.executeTool('dahua.device.info', { device: deviceId }, toolCtx);
                await this.bot.sendMessage(chatId, `Info ${deviceId}\n\`\`\`json\n${JSON.stringify(r, null, 2).slice(0, 3000)}\n\`\`\``, { parse_mode: 'Markdown' });
            } else if (action === 'reboot') {
                await this.bot.sendMessage(chatId, `Rebooting ${deviceId}...`);
                await this.agent.executeTool('dahua.system.reboot', { device: deviceId, reason: 'Telegram quick-action' }, toolCtx);
            } else if (action === 'events') {
                const result = await this.agent.executeTool('dahua.events.search', { query: 'today', device: deviceId }, toolCtx);
                const lines = result.events.slice(-20).map(e => `${e.time} [${e.device}] ${e.code}${e.channel ? ` ch${e.channel}` : ''}`);
                await this.bot.sendMessage(chatId, `Last ${lines.length} event(s):\n\`\`\`\n${lines.join('\n') || 'None'}\n\`\`\``, { parse_mode: 'Markdown' });
            } else if (action === 'ask') {
                await this.bot.sendMessage(chatId, `Ask me anything about the ${deviceId} ch${ch} alert — just type your question.`);
            } else if (action === 'alertson' || action === 'alertsoff') {
                const notifier = this.agent && this.agent.dahuaNotifier;
                const turnOn = action === 'alertson';
                if (notifier) {
                    if (turnOn) notifier.enable(); else notifier.disable();
                }
                this._persistNotifyEnabled(turnOn);
                await this.bot.sendMessage(chatId, turnOn ? '🔔 Alerts turned ON.' : '🔕 Alerts turned OFF.');
                await this._sendDahuaMenu(chatId);
            } else if (action === 'devmenu') {
                const reply_markup = {
                    inline_keyboard: [
                        [{ text: '📸 Snapshot', callback_data: `dahua:snap:${deviceId}:1` }, { text: '🎞 All Channels', callback_data: `dahua:snapall:${deviceId}` }],
                        [{ text: '📡 Stream Ch1', callback_data: `dahua:stream:${deviceId}:1` }, { text: 'ℹ️ Info', callback_data: `dahua:info:${deviceId}` }],
                        [{ text: '📋 Today\'s Events', callback_data: `dahua:events:${deviceId}` }, { text: '🔄 Reboot', callback_data: `dahua:reboot:${deviceId}` }],
                        [{ text: '⬅️ Back', callback_data: 'dahua:menu' }]
                    ]
                };
                await this.bot.sendMessage(chatId, `📷 *${deviceId}*`, { parse_mode: 'Markdown', reply_markup });
            } else if (action === 'searchprompt') {
                await this.bot.sendMessage(chatId, '🔍 Type your question, e.g.:\n`/dahua search front door last night`\n`/dahua summarize what happened today`', { parse_mode: 'Markdown' });
            } else if (action === 'menu') {
                await this._sendDahuaMenu(chatId);
            }
        } catch (err) {
            logger.error(`TelegramChannel dahua callback (${action}): ${err.message}`);
            await this.bot.sendMessage(chatId, `Error: ${err.message}`);
        }
    }

    /** Rating/stock/bestseller line shared by listing, detail, and callback views. */
    _productBadges(p) {
        const bits = [];
        if (p.reviewCount) bits.push(`⭐ ${p.rating.toFixed(1)} (${p.reviewCount})`);
        else bits.push('☆ No reviews yet');
        if (p.stock > 0 && p.stock <= 5) bits.push(`⚠️ Only ${p.stock} left!`);
        if ((p.salesCount || 0) >= 5) bits.push('🔥 Bestseller');
        return bits.join(' · ');
    }

    async _sendProductCard(chatId, p, { extraKeyboard = [] } = {}) {
        const text = `*${p.name}*\n$${p.price} — ${p.stock > 0 ? `${p.stock} in stock` : 'sold out'}\n${this._productBadges(p)}${p.description ? `\n${p.description}` : ''}`;
        const reply_markup = extraKeyboard.length ? { inline_keyboard: extraKeyboard } : undefined;
        if (p.imageUrl) {
            try {
                await this.bot.sendPhoto(chatId, p.imageUrl, { caption: text, parse_mode: 'Markdown', reply_markup });
                return;
            } catch (e) {
                logger.warn(`TelegramChannel: failed to send product image for ${p.id}: ${e.message}`);
            }
        }
        await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup });
    }

    _cartActionsKeyboard() {
        return { inline_keyboard: [
            [
                { text: '✅ Checkout', callback_data: 'shop:checkout:' },
                { text: '🛒 View Cart', callback_data: 'shop:cart:' }
            ],
            [{ text: '⬅️ Keep shopping', callback_data: 'shop:list:' }]
        ] };
    }

    _backButtonRow(callback_data = 'shop:list:', label = '⬅️ Back to catalog') {
        return [{ text: label, callback_data }];
    }

    async _sendUpsell(chatId, productRef) {
        try {
            const related = await this.agent.executeTool('shop.related_products', { productRef, limit: 3 }, { channel: 'telegram' });
            if (!related.length) return;
            const lines = related.map((p) => `• *${p.name}* — $${p.price}`);
            await this.bot.sendMessage(chatId, `✨ *You might also like*\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
        } catch (e) {
            logger.warn(`TelegramChannel: upsell lookup failed: ${e.message}`);
        }
    }

    async _sendShopList(chatId, toolCtx, search) {
        const products = await this.agent.executeTool('shop.list_products', { search }, toolCtx);
        if (!products.length) return this.bot.sendMessage(chatId, '🛍️ No products found.');
        for (const p of products.slice(0, 20)) {
            await this._sendProductCard(chatId, p, { extraKeyboard: [
                [
                    { text: '🛒 Add to cart', callback_data: `shop:add:${p.id}` },
                    { text: 'ℹ️ Details', callback_data: `shop:view:${p.id}` }
                ],
                [{ text: '🔗 View in browser', url: p.url }]
            ] });
        }
    }

    async _sendShopProductDetail(chatId, toolCtx, p) {
        await this._sendProductCard(chatId, p, { extraKeyboard: [
            [
                { text: '🛒 Add to cart', callback_data: `shop:add:${p.id}` },
            ],
            this._backButtonRow()
        ] });
        const reviews = await this.agent.executeTool('shop.list_reviews', { productId: p.id, limit: 3 }, toolCtx).catch(() => []);
        if (reviews.length) {
            const lines = reviews.map((r) => `${'⭐'.repeat(r.rating)} ${r.comment || '(no comment)'}`);
            await this.bot.sendMessage(chatId, `💬 *Recent reviews*\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
        }
    }

    async _sendShopCart(chatId, toolCtx, messageId) {
        const items = await this.agent.executeTool('shop.view_cart', { platform: 'telegram', channelId: chatId }, toolCtx);
        if (!items.length) {
            const reply_markup = { inline_keyboard: [this._backButtonRow()] };
            if (messageId) return this._safeEdit(chatId, messageId, '🛒 Your cart is empty.', { reply_markup });
            return this.bot.sendMessage(chatId, '🛒 Your cart is empty.', { reply_markup });
        }
        const lines = items.map(i => `${i.qty} × ${i.name}${i.size ? ` (${i.size})` : ''} — $${(i.price * i.qty).toFixed(2)}`);
        const reply_markup = { inline_keyboard: [
            [{ text: '✅ Checkout', callback_data: 'shop:checkout:' }],
            this._backButtonRow()
        ] };
        const text = `🛒 *Your Cart*\n\n${lines.join('\n')}`;
        if (messageId) return this._safeEdit(chatId, messageId, text, { parse_mode: 'Markdown', reply_markup });
        await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup });
    }

    async _handleShop(msg, match) {
        const chatId = msg.chat.id;
        const args = match?.[1]?.trim().split(/\s+/) || [];
        const action = args[0] || 'list';
        const toolCtx = { userId: msg._uid || msg.from.id, channel: 'telegram' };

        try {
            if (!this.agent) throw new Error('Agent not initialized');

            if (action === 'list') {
                await this._sendShopList(chatId, toolCtx, args.slice(1).join(' ') || undefined);
            } else if (action === 'product') {
                const p = await this.agent.executeTool('shop.get_product', { productRef: args[1] }, toolCtx);
                if (!p) return this.bot.sendMessage(chatId, `❌ No product matching "${args[1]}".`);
                await this._sendShopProductDetail(chatId, toolCtx, p);
            } else if (action === 'cart') {
                await this._sendShopCart(chatId, toolCtx);
            } else if (action === 'add') {
                const p = await this.agent.executeTool('shop.get_product', { productRef: args[1] }, toolCtx);
                if (!p) return this.bot.sendMessage(chatId, `❌ No product matching "${args[1]}".`);
                if (Array.isArray(p.sizes) && p.sizes.length > 1 && !args[2]) {
                    const reply_markup = { inline_keyboard: [
                        p.sizes.map(s => ({ text: s, callback_data: `shop:addsize:${p.id}:${s}` })),
                        this._backButtonRow(`shop:view:${p.id}`, '⬅️ Back to product')
                    ] };
                    return this.bot.sendMessage(chatId, `📏 *${p.name}* — pick a size:`, { parse_mode: 'Markdown', reply_markup });
                }
                const size = args[2] || (p.sizes?.length === 1 ? p.sizes[0] : undefined);
                const result = await this.agent.executeTool('shop.add_to_cart', { platform: 'telegram', channelId: chatId, productRef: args[1], size }, toolCtx);
                await this.bot.sendMessage(chatId, `✅ Added ${result.product.name} to cart.`, { reply_markup: this._cartActionsKeyboard() });
                await this._sendUpsell(chatId, args[1]);
            } else if (action === 'remove') {
                await this.agent.executeTool('shop.remove_from_cart', { platform: 'telegram', channelId: chatId, keyOrProductId: args[1] }, toolCtx);
                await this.bot.sendMessage(chatId, '🗑️ Removed from cart.');
            } else if (action === 'checkout') {
                const result = await this.agent.executeTool('shop.checkout', { platform: 'telegram', channelId: chatId, payMethod: args[1] || 'cod' }, toolCtx);
                await this.bot.sendMessage(chatId, `✅ Order placed! Invoice ${result.invoiceNumber}\nTotal: $${result.total.toFixed(2)}\n🔗 ${result.url}`);
                await this._sendOrderPdf(chatId, result.orderId).catch(e => logger.warn(`TelegramChannel: failed to send order PDF: ${e.message}`));
            } else if (action === 'invoice') {
                const orderId = args[1];
                if (!orderId) return this.bot.sendMessage(chatId, '❌ Usage: /shop invoice <orderId> [email]');
                if (args[2] === 'email') {
                    await this._emailOrderPdf(chatId, orderId, toolCtx);
                } else {
                    await this._sendOrderPdf(chatId, orderId);
                }
            } else if (action === 'track') {
                const orderId = args[1];
                if (!orderId) return this.bot.sendMessage(chatId, '❌ Usage: /shop track <orderId>');
                const status = await this.agent.executeTool('shop.track_shipment', { orderId }, toolCtx);
                await this.bot.sendMessage(chatId, `📦 *Tracking*\nStatus: ${status.status}\n${status.location ? `Location: ${status.location}\n` : ''}${status.eta ? `ETA: ${status.eta}\n` : ''}${status.trackingUrl ? `🔗 ${status.trackingUrl}` : ''}`, { parse_mode: 'Markdown' });
            } else if (action === 'review') {
                const [productId, ratingStr, ...commentParts] = args.slice(1);
                if (!productId || !ratingStr) return this.bot.sendMessage(chatId, '❌ Usage: /shop review <productId> <1-5> [comment]');
                const result = await this.agent.executeTool('shop.submit_review', { productId, rating: Number(ratingStr), comment: commentParts.join(' ') }, toolCtx);
                await this.bot.sendMessage(chatId, `✅ Thanks for your ${'⭐'.repeat(result.rating)} review!`);
            } else {
                await this.bot.sendMessage(chatId, `❌ Unknown action: ${action}. Use list, product, cart, add, remove, checkout, invoice, track, review.`);
            }
        } catch (err) {
            logger.error('TelegramChannel Shop error:', err);
            await this.bot.sendMessage(chatId, `❌ Shop error: ${err.message}`);
        }
    }

    async _handleShopCallback(chatId, action, extra, messageId, query) {
        const toolCtx = { userId: query?._uid || chatId, channel: 'telegram' };
        try {
            if (action === 'view') {
                const p = await this.agent.executeTool('shop.get_product', { productRef: extra }, toolCtx);
                if (!p) return this.bot.sendMessage(chatId, '❌ Product not found.');
                // Photo-based card — can't editMessageText a media message, so drop the
                // old screen before drawing the new one (keeps the "back replaces the
                // screen" UX the rest of the bot's menus already use).
                if (messageId) await this.bot.deleteMessage(chatId, messageId).catch(() => {});
                await this._sendShopProductDetail(chatId, toolCtx, p);
            } else if (action === 'add') {
                const p = await this.agent.executeTool('shop.get_product', { productRef: extra }, toolCtx);
                if (!p) return this.bot.sendMessage(chatId, '❌ Product not found.');
                if (Array.isArray(p.sizes) && p.sizes.length > 1) {
                    const reply_markup = { inline_keyboard: [
                        p.sizes.map(s => ({ text: s, callback_data: `shop:addsize:${p.id}:${s}` })),
                        this._backButtonRow(`shop:view:${p.id}`, '⬅️ Back to product')
                    ] };
                    return this.bot.sendMessage(chatId, `📏 *${p.name}* — pick a size:`, { parse_mode: 'Markdown', reply_markup });
                }
                const size = p.sizes?.length === 1 ? p.sizes[0] : undefined;
                const result = await this.agent.executeTool('shop.add_to_cart', { platform: 'telegram', channelId: chatId, productRef: extra, size }, toolCtx);
                await this.bot.sendMessage(chatId, `✅ Added ${result.product.name} to cart.`, { reply_markup: this._cartActionsKeyboard() });
                await this._sendUpsell(chatId, extra);
            } else if (action === 'addsize') {
                const [productId, size] = extra.split(':');
                const result = await this.agent.executeTool('shop.add_to_cart', { platform: 'telegram', channelId: chatId, productRef: productId, size }, toolCtx);
                await this.bot.sendMessage(chatId, `✅ Added ${result.product.name} (${size}) to cart.`, { reply_markup: this._cartActionsKeyboard() });
                await this._sendUpsell(chatId, productId);
            } else if (action === 'checkout') {
                const result = await this.agent.executeTool('shop.checkout', { platform: 'telegram', channelId: chatId, payMethod: 'cod' }, toolCtx);
                await this.bot.sendMessage(chatId, `✅ Order placed! Invoice ${result.invoiceNumber}\nTotal: $${result.total.toFixed(2)}\n🔗 ${result.url}`);
                await this._sendOrderPdf(chatId, result.orderId).catch(e => logger.warn(`TelegramChannel: failed to send order PDF: ${e.message}`));
            } else if (action === 'cart') {
                await this._sendShopCart(chatId, toolCtx, messageId);
            } else if (action === 'list') {
                if (messageId) await this.bot.deleteMessage(chatId, messageId).catch(() => {});
                await this._sendShopList(chatId, toolCtx);
            }
        } catch (err) {
            logger.error(`TelegramChannel shop callback (${action}): ${err.message}`);
            await this.bot.sendMessage(chatId, `Error: ${err.message}`);
        }
    }

    /** Generates and sends an order's invoice (cod) or receipt (paid) PDF as a document. */
    async _sendOrderPdf(chatId, orderId, caption) {
        const shop = require('../shop');
        const { generateOrderPdf } = require('../invoice-pdf');
        const order = await shop.getOrder(orderId);
        if (!order) { await this.bot.sendMessage(chatId, '❌ Order not found.'); return; }
        const label = order.status === 'paid' ? 'Receipt' : 'Invoice';
        const pdf = await generateOrderPdf({ ...order, orderId: order.id });
        await this.bot.sendDocument(
            chatId, pdf,
            { caption: caption || `${label} ${order.invoiceNumber}` },
            { filename: `${order.invoiceNumber || order.id}.pdf`, contentType: 'application/pdf' }
        );
    }

    /** Emails an order's invoice/receipt PDF to the caller's linked email address. */
    async _emailOrderPdf(chatId, orderId, toolCtx) {
        const shop = require('../shop');
        const { generateOrderPdf } = require('../invoice-pdf');
        const { getDatabase } = require('../database');
        const db = await getDatabase();

        const order = await shop.getOrder(orderId);
        if (!order) return this.bot.sendMessage(chatId, '❌ Order not found.');

        const userDoc = toolCtx.userId ? await db.getUser(toolCtx.userId).catch(() => null) : null;
        const email = userDoc?.email;
        if (!email) {
            return this.bot.sendMessage(chatId, '❌ No linked email on file. Use `/link your@email.com` first.', { parse_mode: 'Markdown' });
        }

        const channelManager = global.gateway?.channelManager;
        const emailChannel = channelManager?.channels?.get('email');
        if (!emailChannel) return this.bot.sendMessage(chatId, '❌ Email delivery is not configured on this gateway.');

        const label = order.status === 'paid' ? 'Receipt' : 'Invoice';
        const pdf = await generateOrderPdf({ ...order, orderId: order.id });
        await emailChannel.send(email, {
            subject: `${label} ${order.invoiceNumber}`,
            text: `Your ${label.toLowerCase()} for order ${order.invoiceNumber} is attached.`,
            attachments: [{ filename: `${order.invoiceNumber || order.id}.pdf`, content: pdf }],
        });
        await this.bot.sendMessage(chatId, `✅ Sent to ${email}.`);
    }

    async _handlePrintCallback(chatId, code, messageId) {
        const { getDatabase } = require('../database');
        const db = await getDatabase();
        const v = await db.getVoucher(code);
        
        if (!v) return this.bot.sendMessage(chatId, `❌ Voucher ${code} not found.`);
        
        try {
            await this.bot.sendMessage(chatId, `🖨 *Printing voucher:* \`${code}\`...`, { parse_mode: 'Markdown' });

            const voucherData = {
                username: code,
                password: code,
                profile: v.planName || v.plan,
                loginUrl: v.loginUrl || `http://hotspot.local/login?username=${code}`,
                expires: v.expiresAt,
                price: v.value,
                currency: v.currency,
                duration: v.durationValue ? `${v.durationValue}${v.durationUnit === 'hours' ? 'h' : v.durationUnit === 'days' ? 'd' : v.durationUnit === 'weeks' ? 'w' : ''}` : undefined
            };

            const result = await PrintBroker.getInstance().print(voucherData);
            const via = result.via === 'mobile' ? '📱 mobile (BLE/USB)' : '💻 server';

            if (result.success) {
                await this.bot.sendMessage(chatId, `✅ Printed \`${code}\` via ${via}.`);
            } else {
                await this.bot.sendMessage(chatId, `❌ Print failed (${via}): ${result.error}`);
            }
        } catch (err) {
            await this.bot.sendMessage(chatId, `❌ Print failed: ${err.message}`);
        }
    }

    async _handleVupdateCallback(chatId, code, newPlan, messageId) {
        const { getDatabase } = require('../database');
        const db = await getDatabase();
        
        if (!newPlan) {
            // Show plan picker for updating
            let plans = await db.getPlans(true).catch(() => []);
            const rows = plans.map(p => ([{
                text: `🔄 ${p.name}`,
                callback_data: `vupdate:${code}:${p.mikrotikProfile || p.id || p.name}`
            }]));
            rows.push([{ text: '🔙 Cancel', callback_data: 'process:voucher' }]);
            
            return this._safeEdit(chatId, messageId, `✏️ *Update Plan for* \`${code}\`\n\nSelect new plan:`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: rows }
            });
        }

        // Execute update
        try {
            const voucherAgent = require('../voucher');
            await this._safeEdit(chatId, messageId, `⏳ *Updating* \`${code}\` to *${newPlan}*...`, { parse_mode: 'Markdown' });
            
            const updated = await voucherAgent.updateVoucher(code, newPlan);
            
            await this._safeEdit(chatId, messageId, `✅ *Voucher Updated*\n\nCode: \`${code}\`\nNew Plan: *${updated.planName || updated.plan}*\n\n_Sending to printer..._`, { parse_mode: 'Markdown' });
            
            const result = await PrintBroker.getInstance().print({
                username: code,
                password: code,
                profile: updated.planName || updated.plan,
                loginUrl: updated.loginUrl,
                expires: updated.expiresAt,
                price: updated.value,
                currency: updated.currency,
                duration: updated.durationValue ? `${updated.durationValue}${updated.durationUnit === 'hours' ? 'h' : updated.durationUnit === 'days' ? 'd' : updated.durationUnit === 'weeks' ? 'w' : ''}` : undefined
            });
            const via = result.via === 'mobile' ? '📱 mobile (BLE/USB)' : '💻 server';
            if (!result.success) {
                await this.bot.sendMessage(chatId, `⚠️ Voucher updated but print failed (${via}): ${result.error}`);
            }
        } catch (err) {
            await this.bot.sendMessage(chatId, `❌ Update failed: ${err.message}`);
        }
    }

    async _dispatchProcessButton(chatId, messageId, action, query) {
        const opts = { editMessageId: messageId };
        const msgStub = { chat: { id: chatId }, from: query.from };

        // Support pay:planId compound action e.g. process:pay:1Hour
        if (action && action.startsWith('pay:')) {
            const planId = action.substring(4);
            return this._handlePay(msgStub, [null, planId], opts);
        }

        const map = {
            start: () => this._handleStart(msgStub, opts),
            dashboard: () => this._handleDashboard(msgStub, opts),
            tools: () => this._handleTools(msgStub, opts),
            network: () => this._handleNetwork(msgStub, opts),
            users: () => this._handleUsers(msgStub, opts),
            status: () => this._handleStats(msgStub, opts),
            voucher: () => this._handleVoucher(msgStub, null, opts),
            voucher_debug: () => this._handleVoucherDebug(msgStub, opts),
            bulk: () => this._handleBulkVoucher(chatId, 'pick', '', messageId, query),
            wallet: () => this._handleWallet(msgStub, opts),
            pay: () => this._handlePay(msgStub, null, opts),
            help: () => this._handleHelp(msgStub, null, opts),
            reboot: () => this._handleReboot(msgStub, opts),
            kick: () => this._handleKick(msgStub, null, opts)
        };
        if (map[action]) {
            await map[action]();
            return;
        }
        // Unknown action fallback — edit in place when possible, never send a raw new bubble
        logger.warn(`Unknown process action: ${action}`);
        const fallbackText = `⚙️ Unknown action: \`${action}\`\n\nUse /menu to navigate.`;
        if (messageId) {
            await this._safeEdit(chatId, messageId, fallbackText, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'process:start' }]] }
            });
        } else {
            await this.bot.sendMessage(chatId, fallbackText, { parse_mode: 'Markdown' });
        }
    }

    async _dispatchNetButton(chatId, messageId, action, query) {
        const fakeMsg = { chat: { id: chatId }, from: query.from || { first_name: 'User' } };
        const opts = { editMessageId: messageId };
        const map = {
            ping: () => this._handlePing(fakeMsg, null, opts),
            firewall: () => this._sendFirewallRules(chatId, opts),
            dhcp: () => this._sendDhcpLeases(chatId, opts),
            bandwidth: () => this._sendInterfaces(chatId, opts),
            reboot: () => this._handleReboot(fakeMsg),
            traceroute: () => this._handleTraceroute(fakeMsg, null, opts),
            scan: () => this._sendNeighbors(chatId, opts),
            health: () => this._sendHealth(chatId, opts),
            logs: () => this._sendLogs(chatId, opts),
            connections: () => this._sendConnections(chatId, opts),
            ips: () => this._sendIpAddresses(chatId, opts),
            dns: () => this._sendDns(chatId, opts)
        };
        if (map[action]) await map[action]();
        else {
            logger.warn(`Unknown net action: ${action}`);
            const fallbackText = `⚠️ Unknown network action: \`${action}\``;
            if (messageId) await this._safeEdit(chatId, messageId, fallbackText, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'process:network' }]] }
            });
        }
    }

    async _dispatchUsersButton(chatId, messageId, action, query) {
        const opts = { editMessageId: messageId };
        const map = {
            active: () => this._sendUsers(chatId, opts),
            all: () => this._sendAllUsers(chatId, opts),
            kick: () => this._sendUsers(chatId, opts),
            remove: () => this._sendAllUsers(chatId, { ...opts, showRemove: true }),
            profiles: () => this._sendProfiles(chatId, opts),
            status: () => this.promptUser(chatId, '🔍 *User Status*\nPlease enter the username:', 'tool:user.status'),
            add: () => this.promptUser(chatId,
                '➕ *Add Hotspot User*\nEnter: `username password plan`\nExample: `john pass123 1Day`',
                'tool:user.add'
            ),
            edit: () => this.promptUser(chatId,
                '✏️ *Edit User*\nEnter: `username [password] [profile]`\nExample: `john newpass 1Day`\n\n_Omit fields to keep unchanged._',
                'users:doedit'
            )
        };
        if (map[action]) {
            await map[action]();
        } else if (action === 'doedit') {
            // callback from per-user inline edit button: users:doedit:<username>
            await this._editUserFlow(chatId, messageId, query.data?.split(':')[2] || null);
        } else if (action === 'doremove') {
            const username = query.data?.split(':')[2];
            await this._doRemoveUser(chatId, username, opts);
        } else {
            logger.warn(`Unknown users action: ${action}`);
            const fallbackText = `⚠️ Unknown users action: \`${action}\``;
            if (messageId) await this._safeEdit(chatId, messageId, fallbackText, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'process:users' }]] }
            });
        }
    }

    async _handleNetwork(msg, opts = {}) {
        const text = '🌐 *Network* — Select action:';
        const reply_markup = {
            inline_keyboard: [
                [{ text: '📡 Ping', callback_data: 'net:ping' }, { text: '🛤 Trace', callback_data: 'net:traceroute' }],
                [{ text: '🔥 Firewall', callback_data: 'net:firewall' }, { text: '🔗 Conns', callback_data: 'net:connections' }],
                [{ text: '📋 DHCP', callback_data: 'net:dhcp' }, { text: '🔍 Neighbors', callback_data: 'net:scan' }],
                [{ text: '📊 Interface', callback_data: 'net:bandwidth' }, { text: '🌡 Health', callback_data: 'net:health' }],
                [{ text: '🌐 IPs', callback_data: 'net:ips' }, { text: '🏷 DNS', callback_data: 'net:dns' }],
                [{ text: '📜 Logs', callback_data: 'net:logs' }, { text: '⚡ Reboot', callback_data: 'process:reboot' }],
                [{ text: '⬅️ Back', callback_data: 'process:start' }]
            ]
        };

        if (opts.editMessageId) {
            await this._safeEdit(msg.chat.id, opts.editMessageId, text, { parse_mode: 'Markdown', reply_markup });
        } else {
            await this.bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown', reply_markup });
        }
    }

    async _handlePay(msg, match, opts = {}) {
        const chatId = msg.chat.id;
        const planId = match?.[1];

        const { getDatabase } = require('../database');
        const db = await getDatabase();
        const wallet = await db.getWallet(chatId);
        const balance = wallet.balance || 0;
        const currency = wallet.currency || 'USD';

        // ── If no plan specified, show plan picker ────────────────────────────
        if (!planId) {
            try {
                let plans = await db.getPlans(true);
                if (!plans.length) {
                    const { getConfig } = require('../config');
                    const cfg = getConfig();
                    plans = Array.isArray(cfg.plans) ? cfg.plans.filter(p => p.active !== false) : [];
                }
                if (!plans.length) {
                    plans = [
                        { id: '1Hour', name: '1 Hour', price: 0.50, durationValue: 1, durationUnit: 'hours', deviceLimit: 1, mikrotikProfile: '1Hour' },
                        { id: '1Day', name: '1 Day', price: 1.00, durationValue: 1, durationUnit: 'days', deviceLimit: 1, mikrotikProfile: '1Day' },
                        { id: '7Day', name: '7 Days', price: 3.00, durationValue: 7, durationUnit: 'days', deviceLimit: 1, mikrotikProfile: '7Day' },
                        { id: '30Day', name: '30 Days', price: 5.00, durationValue: 30, durationUnit: 'days', deviceLimit: 3, mikrotikProfile: '30Day' },
                    ];
                }

                const rows = plans.map(p => {
                    const pid = p.mikrotikProfile || p.id || p.name;
                    const dur = p.durationValue && p.durationUnit
                        ? `${p.durationValue}${p.durationUnit[0]}`
                        : '∞';
                    const priceStr = p.price > 0 ? `${p.price} ${currency}` : 'Free';
                    return [{ text: `💳 ${p.name}  ·  ${dur}  ·  ${priceStr}`, callback_data: `process:pay:${pid}` }];
                });
                rows.push([{ text: '👛 Wallet Balance', callback_data: 'process:wallet' }]);
                rows.push([{ text: '🔙 Back', callback_data: 'process:start' }]);

                const text =
                    `💳 *Purchase a Plan*\n\n` +
                    `Your balance: *${balance.toFixed(2)} ${currency}*\n\n` +
                    `Choose a plan to purchase:`;

                if (opts.editMessageId) {
                    return this._safeEdit(chatId, opts.editMessageId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
                }
                return this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
            } catch (err) {
                const errText = `❌ Could not load plans: ${err.message}`;
                if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, errText);
                return this.bot.sendMessage(chatId, errText);
            }
        }

        // ── Specific plan selected ────────────────────────────────────────────
        const planObj = await db.getPlan(planId);
        const price = planObj ? Number(planObj.price || 0) : 1.00;
        const planCurrency = planObj?.currency || currency;

        const text = `💳 *Payment for ${planObj?.name || planId} Plan*\n\n` +
            `Amount: *${price.toFixed(2)} ${planCurrency}*\n` +
            `Your balance: *${balance.toFixed(2)} ${currency}*\n\n` +
            `Select payment method:`;
        const reply_markup = {
            inline_keyboard: [
                [{ text: '👛 Wallet Balance', callback_data: `pay:wallet:${planId}` }],
                [{ text: '💳 Stripe / Card', callback_data: `pay:stripe:${planId}` }],
                [{ text: '💰 Crypto (USDT)', callback_data: `pay:crypto:${planId}` }],
                [{ text: '🔙 Back to Plans', callback_data: 'process:pay' }]
            ]
        };

        if (opts.editMessageId) {
            return this._safeEdit(chatId, opts.editMessageId, text, { parse_mode: 'Markdown', reply_markup });
        } else {
            await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup });
        }
    }

    async _handlePayAction(chatId, method, plan, opts = {}) {
        const messageId = opts.editMessageId;
        const { getDatabase } = require('../database');
        const db = await getDatabase();
        const planObj = await db.getPlan(plan);
        const wallet = await db.getWallet(chatId);
        const price = planObj ? Number(planObj.price || 0) : 1.00;
        const currency = planObj?.currency || wallet.currency || 'USD';

        if (method === 'wallet') {
            try {
                await db.deductCredits(chatId, price, `Purchase of ${planObj?.name || plan} plan via wallet`);
                const successText = `✅ *Payment Successful!* Credits deducted.\n\n_Creating your voucher..._`;
                if (messageId) await this._safeEdit(chatId, messageId, successText);
                else await this.bot.sendMessage(chatId, successText, { parse_mode: 'Markdown' });

                return this._createVoucher(chatId, plan, messageId);
            } catch (err) {
                const errText = `❌ *Payment Failed:* ${err.message}`;
                if (messageId) return this._safeEdit(chatId, messageId, errText, { parse_mode: 'Markdown' });
                return this.bot.sendMessage(chatId, errText, { parse_mode: 'Markdown' });
            }
        }

        const procText = `🔄 *Starting ${method} payment for ${plan} plan...*`;
        if (messageId) await this._safeEdit(chatId, messageId, procText);
        else await this.bot.sendMessage(chatId, procText, { parse_mode: 'Markdown' });

        try {
            if (method === 'stripe') {
                const res = await this.agent.executeTool('payment.stripe.create', { plan, channel: 'telegram', userId: chatId });
                const linkText = `🔗 *Checkout Link:* ${res.url}`;
                if (messageId) await this._safeEdit(chatId, messageId, linkText);
                else await this.bot.sendMessage(chatId, linkText, { parse_mode: 'Markdown' });
            } else {
                const skipText = `⚠️ ${method} payment not yet implemented in this channel.`;
                if (messageId) await this._safeEdit(chatId, messageId, skipText);
                else await this.bot.sendMessage(chatId, skipText);
            }
        } catch (err) {
            const failText = `❌ Payment failed: ${err.message}`;
            if (messageId) await this._safeEdit(chatId, messageId, failText);
            else await this.bot.sendMessage(chatId, failText);
        }
    }

    async _handleWallet(msg, opts = {}) {
        const chatId = msg.chat.id;
        try {
            const { getDatabase } = require('../database');
            const db = await getDatabase();
            const wallet = await db.getWallet(chatId);
            const history = await db.getTransactions(5, { userId: chatId });

            let text = `👛 *Your Wallet*\n\n` +
                `Balance: *$${(wallet.balance || 0).toFixed(2)} ${wallet.currency || 'USD'}*\n\n` +
                `*Recent Activity:*\n`;

            if (history.length) {
                history.forEach(tx => {
                    const sign = tx.type === 'wallet_topup' ? '+' : '-';
                    text += `• ${sign}$${tx.amount.toFixed(2)} (${tx.type}) — ${new Date(tx.createdAt).toLocaleDateString()}\n`;
                });
            } else {
                text += `_No recent transactions._`;
            }

            const reply_markup = {
                inline_keyboard: [
                    [{ text: '➕ Top Up', callback_data: 'wallet:topup' }],
                    [{ text: '🔙 Back', callback_data: 'process:start' }]
                ]
            };

            if (opts.editMessageId) {
                await this._safeEdit(chatId, opts.editMessageId, text, { parse_mode: 'Markdown', reply_markup });
            } else {
                await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup });
            }
        } catch (err) {
            await this.bot.sendMessage(chatId, `❌ Wallet error: ${err.message}`);
        }
    }

    async _sendDashboard(msg, opts = {}) {
        const chatId = msg.chat ? msg.chat.id : msg;
        const reply_markup = {
            inline_keyboard: [
                [{ text: '🔄 Refresh', callback_data: 'process:dashboard' }],
                [{ text: '🔙 Back to Menu', callback_data: 'process:start' }]
            ]
        };

        if (!this.mikrotik) {
            const text = `📊 *AgentOS Dashboard*\n\n🔴 *MikroTik Not Connected*\n\nPlease configure your router.`;
            if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, text, { parse_mode: 'Markdown', reply_markup });
            return this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup });
        }

        try {
            const { getDatabase } = require('../database');
            const db = await getDatabase();

            let resource = null;
            let activeUsers = [];

            try {
                resource = await (this.mikrotik.getSystemResource?.() || this.mikrotik.executeTool('system.resource'));
            } catch (err) {
                logger.warn(`Dashboard: Could not fetch resource: ${err.message}`);
            }

            try {
                activeUsers = await (this.mikrotik.getActiveUsers?.() || this.mikrotik.executeTool('users.active'));
            } catch (err) {
                logger.warn(`Dashboard: Could not fetch active users: ${err.message}`);
            }

            const revenue = await db.getRevenue?.('daily').catch(() => ({ total: 0, count: 0 })) || { total: 0, count: 0 };

            const cpu = parseInt(resource?.['cpu-load'] || 0);
            const memTotal = parseInt(resource?.['total-memory'] || 0);
            const memFree = parseInt(resource?.['free-memory'] || 0);
            const memUsedPercent = memTotal > 0 ? Math.round(((memTotal - memFree) / memTotal) * 100) : 0;

            const cpuEmoji = Number(cpu) > 80 ? '🔴' : Number(cpu) > 50 ? '🟡' : '🟢';
            const memEmoji = memUsedPercent > 80 ? '🔴' : memUsedPercent > 50 ? '🟡' : '🟢';

            const routerStatus = resource ?
                `🖥️ *Router Status*\n` +
                `${cpuEmoji} CPU: *${cpu}%*\n` +
                `${memEmoji} RAM: *${memUsedPercent}%* used\n` +
                `⏱ Uptime: *${resource?.uptime || 'N/A'}*\n` +
                `📦 OS: *${resource?.version || 'N/A'}*\n\n` :
                `🖥️ *Router Status*: 🔴 Offline\n\n`;

            // Wallet / finance summary
            const uid = msg?._uid || chatId;
            const wallet = await db.getWallet(uid).catch(() => ({ balance: 0, currency: 'USD' }));
            const walletLine = `💳 Balance: *${(wallet.balance || 0).toFixed(2)} ${wallet.currency || 'USD'}*\n`;

            const text = `📊 *AgentOS Dashboard*\n\n` +
                routerStatus +
                `🌐 *Network*\n` +
                `🟢 Active Users: *${activeUsers?.length || 0}*\n\n` +
                `💰 *Finance (Today)*\n` +
                `💵 Revenue: *${revenue.total ? revenue.total.toFixed(2) : '0.00'} USD*\n` +
                `🎫 Sales: *${revenue.count || 0}* vouchers\n` +
                walletLine + `\n` +
                (resource ? `✅ System healthy` : `⚠️ Router offline`);

            const reply_markup = {
                inline_keyboard: [
                    [{ text: '🔄 Refresh', callback_data: 'process:dashboard' }, { text: '👥 Users', callback_data: 'process:users' }],
                    [{ text: '💳 Buy Plan', callback_data: 'process:pay' }, { text: '🎫 Voucher', callback_data: 'process:voucher' }],
                    [{ text: '🌐 Network', callback_data: 'process:network' }, { text: '👛 Wallet', callback_data: 'process:wallet' }],
                    [{ text: '🔙 Main Menu', callback_data: 'process:start' }]
                ]
            };

            if (opts.editMessageId) {
                await this._safeEdit(chatId, opts.editMessageId, text, { parse_mode: 'Markdown', reply_markup });
            } else {
                await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup });
            }
        } catch (err) {
            logger.error('TelegramChannel Dashboard error:', err);
            const reply_markup = {
                inline_keyboard: [[{ text: '🔄 Retry', callback_data: 'process:dashboard' }, { text: '🔙 Menu', callback_data: 'process:start' }]]
            };
            const errText = `❌ Dashboard error: ${err.message}`;
            if (opts.editMessageId) await this._safeEdit(chatId, opts.editMessageId, errText, { reply_markup });
            else await this.bot.sendMessage(chatId, errText, { reply_markup });
        }
    }

    async _sendUsers(chatId, opts = {}) {
        if (!this.mikrotik) {
            return this.bot.sendMessage(chatId, '⚠️ MikroTik not connected.');
        }
        try {
            const users = await (this.mikrotik.getActiveUsers?.() || this.mikrotik.executeTool('users.active'));
            if (!users?.length) {
                const noUsersText = '👥 No active users.';
                if (opts.editMessageId) {
                    return this._safeEdit(chatId, opts.editMessageId, noUsersText);
                }
                return this.bot.sendMessage(chatId, noUsersText);
            }

            let msg = `👥 *Active Sessions: ${users.length}*\n\n`;
            const keyboard = [];
            users.slice(0, 20).forEach((u, i) => {
                const name = u.user || u.name || 'Unknown';
                const ip = u.address || 'N/A';
                const uptime = u.uptime || 'N/A';
                const byteIn = this._formatBytes(Number(u['bytes-in'] || 0));
                const byteOut = this._formatBytes(Number(u['bytes-out'] || 0));
                msg += `${i + 1}. *${name}* — ${ip}\n   ⏱ ${uptime} | ↓${byteIn} ↑${byteOut}\n`;
                keyboard.push([{ text: `❌ Kick ${name}`, callback_data: `kick:${name}` }]);
            });
            keyboard.push([{ text: '🔙 Back', callback_data: 'process:users' }]);

            if (opts.editMessageId) {
                await this._safeEdit(chatId, opts.editMessageId, msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
            } else {
                await this.bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
            }
        } catch (err) {
            const errText = `❌ Failed to get users: ${err.message}`;
            if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, errText);
            await this.bot.sendMessage(chatId, errText);
        }
    }

    async _sendStats(chatId, opts = {}) {
        if (!this.mikrotik) return this.bot.sendMessage(chatId, '⚠️ MikroTik not connected.');
        try {
            const stats = await (this.mikrotik.getSystemStats?.() || this.mikrotik.executeTool('system.stats'));
            const text =
                `📈 *System Status*\n\n` +
                `CPU: \`${stats?.['cpu-load'] ?? 0}%\`\n` +
                `RAM: \`${stats?.['memory-usage-percent'] ?? 0}%\`\n` +
                `Uptime: \`${stats?.uptime ?? 'N/A'}\`\n` +
                `Version: \`${stats?.version ?? 'N/A'}\`\n` +
                `Board: \`${stats?.['board-name'] ?? 'N/A'}\``;

            const reply_markup = { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'process:start' }]] };

            if (opts.editMessageId) {
                await this._safeEdit(chatId, opts.editMessageId, text, { parse_mode: 'Markdown', reply_markup });
            } else {
                await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup });
            }
        } catch (err) {
            const errText = `❌ Status error: ${err.message}`;
            if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, errText);
            await this.bot.sendMessage(chatId, errText);
        }
    }



    async _createVoucher(chatId, planId, messageId = null) {
        try {
            // ── Resolve full plan object ──────────────────────────────────────
            let planObj = null;
            try {
                const { getDatabase } = require('../database');
                const db = await getDatabase();
                planObj = await db.getPlan(planId);
                if (!planObj) {
                    const all = await db.getPlans(false);
                    planObj = all.find(p => p.mikrotikProfile === planId || p.name === planId);
                }
            } catch (_) { /* best-effort plan lookup */ }

            if (!planObj) {
                const { getConfig } = require('../config');
                const plans = Array.isArray(getConfig().plans) ? getConfig().plans : [];
                planObj = plans.find(p => p.mikrotikProfile === planId || p.name === planId);
            }

            if (!planObj) {
                planObj = { name: planId, mikrotikProfile: planId, durationUnit: 'days', durationValue: 1, deviceLimit: 1, price: 0 };
            }

            const profile = planObj.mikrotikProfile || planId;
            const planName = planObj.name || planId;
            const price = Number(planObj.price || 0);

            // ── Payment Check ────────────────────────────────────────────────
            const { getDatabase } = require('../database');
            const db = await getDatabase();
            const user = await db.getUser(chatId);
            const isStaff = user?.role === 'admin' || user?.role === 'reseller';

            if (!isStaff && price > 0) {
                try {
                    await db.deductCredits(chatId, price, `Purchase of ${planName} voucher`);
                } catch (err) {
                    const wallet = await db.getWallet(chatId);
                    const balance = wallet.balance || 0;
                    const currency = wallet.currency || 'USD';
                    const failText =
                        `❌ *Insufficient Balance*\n\n` +
                        `This voucher costs *${price} ${currency}*.\n` +
                        `Your balance: *${balance} ${currency}*\n\n` +
                        `_Top up via the /wallet menu._`;
                    const markup = {
                        inline_keyboard: [
                            [{ text: '💰 Top Up Wallet', callback_data: 'process:wallet' }],
                            [{ text: '⬅️ Back to Plans', callback_data: 'process:voucher' }]
                        ]
                    };
                    if (messageId) return this._safeEdit(chatId, messageId, failText, { parse_mode: 'Markdown', reply_markup: markup });
                    return this.bot.sendMessage(chatId, failText, { parse_mode: 'Markdown', reply_markup: markup });
                }
            }

            // ── Show progress ─────────────────────────────────────────────────
            const procText = `⏳ *Generating ${planName} Voucher...*`;
            if (messageId) await this._safeEdit(chatId, messageId, procText, { parse_mode: 'Markdown' });
            else {
                const sent = await this.bot.sendMessage(chatId, procText, { parse_mode: 'Markdown' });
                messageId = sent.message_id;
            }

            // ── Compute expiry ────────────────────────────────────────────────
            let expiresAt = null;
            try {
                const UniversalBilling = require('../universal-billing');
                expiresAt = new UniversalBilling().calculateExpiry(planObj);
            } catch (_) {
                if (planObj.durationValue && planObj.durationUnit) {
                    const ms = { hours: 3600000, days: 86400000, weeks: 604800000 };
                    const factor = ms[planObj.durationUnit] || ms['days'];
                    expiresAt = new Date(Date.now() + planObj.durationValue * factor).toISOString();
                }
            }

            // ── Generate voucher code ─────────────────────────────────────────
            const voucherAgent = require('../voucher');
            const QRCode = require('qrcode');
            const code = await voucherAgent.generate(profile);

            // ── Build login URL (used in QR + DB) ────────────────────────────
            const routerIp = this.mikrotik?.config?.host || '192.168.88.1';
            const loginUrl = `http://${routerIp}/login?username=${code}&password=${code}`;

            // ── Persist to DB ─────────────────────────────────────────────────
            try {
                await db.createVoucher(code, {
                    plan: profile,
                    planName,
                    durationUnit: planObj.durationUnit || null,
                    durationValue: planObj.durationValue || null,
                    deviceLimit: planObj.deviceLimit || 1,
                    expiresAt,
                    loginUrl,
                    createdBy: String(chatId),   // ← actual creator identity
                    value: price,
                    currency: user?.currency || 'USD',
                });
            } catch (dbErr) {
                logger.warn(`DB voucher save failed: ${dbErr.message}`);
            }

            // ── Update user subscription record ───────────────────────────────
            try {
                await db.updateSubscription(chatId, {
                    planId: profile,
                    planName,
                    purchasedAt: new Date().toISOString(),
                    expiresAt,
                });
            } catch (subErr) {
                logger.warn(`Subscription update failed: ${subErr.message}`);
            }

            // ── Add to MikroTik hotspot (non-fatal) ───────────────────────────
            const mt = this.mikrotik || global.mikrotik || null;
            let mtStatus = '✅ Added to router';
            if (mt) {
                try {
                    await mt.addHotspotUser({
                        username: code,
                        password: code,
                        profile,
                        sharedUsers: planObj.deviceLimit || 1,
                        ...(expiresAt && { limitUptime: this._durationToMikrotik(planObj) }),
                    });
                    logger.info(`Voucher ${code} added to MikroTik (profile: ${profile})`);
                } catch (e) {
                    mtStatus = '⚠️ Router sync pending';
                    logger.error(`MikroTik addHotspotUser failed for ${code}: ${e.message}`);
                }
            } else {
                mtStatus = '⚠️ No router connected';
            }

            // ── Print Voucher (Background) ───────────────────────────────────
            try {
                // We don't await this to keep the Telegram bot responsive
                printVoucher({
                    username: code,
                    password: code,
                    profile,
                    loginUrl,
                    expires: expiresAt,
                    price: price,
                    currency: user?.currency || 'USD',
                    duration: planObj.durationValue ? `${planObj.durationValue}${planObj.durationUnit === 'hours' ? 'h' : planObj.durationUnit === 'days' ? 'd' : planObj.durationUnit === 'weeks' ? 'w' : ''}` : undefined
                }).catch(pErr => logger.error(`[Telegram] Background print failed for ${code}: ${pErr.message}`));
                logger.info(`[Telegram] Printer handoff successful for voucher: ${code}`);
            } catch (pErr) {
                logger.error(`[Telegram] Printer trigger failed: ${pErr.message}`);
            }

            // ── Generate QR ──────────────────────────────────────────────────
            const qrBuf = await QRCode.toBuffer(loginUrl);

            const durationLabel = planObj.durationUnit
                ? `${planObj.durationValue} ${planObj.durationUnit}`
                : 'Unlimited';
            const expiryLabel = expiresAt
                ? new Date(expiresAt).toLocaleString()
                : 'No expiry';
            const currency = user?.currency || 'USD';
            const paidLabel = (price > 0 && !isStaff)
                ? `${price} ${currency}`
                : (isStaff ? 'Free (Admin)' : 'Free');

            // Delete progress message before sending photo
            if (messageId) {
                await this.bot.deleteMessage(chatId, messageId).catch(() => { });
                messageId = null;
            }

            const caption =
                `🎫 *Voucher Created Successfully!*\n\n` +
                `\`${code}\`\n\n` +
                `📋 *Plan:*     ${planName}\n` +
                `⏱ *Duration:* ${durationLabel}\n` +
                `📅 *Expires:*  ${expiryLabel}\n` +
                `📱 *Devices:*  ${planObj.deviceLimit || 1}\n` +
                `💳 *Paid:*     ${paidLabel}\n` +
                `🔌 *Router:*   ${mtStatus}\n\n` +
                `_Scan QR or enter code at the captive portal._`;

            await this.bot.sendPhoto(chatId, qrBuf, {
                caption:
                    `🎫 *Voucher Created*\n\n` +
                    `Code: \`${code}\`\n` +
                    `Plan: *${planName}*\n` +
                    `Duration: *${durationLabel}*\n` +
                    `Expires: *${expiryLabel}*\n` +
                    `Devices: *${planObj.deviceLimit || 1}*\n\n` +
                    `_Scan QR or enter code at captive portal_`,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🖨 Reprint Voucher', callback_data: `print:${code}` }],
                        [{ text: '📤 Share Voucher', url: `https://t.me/share/url?url=${encodeURIComponent(`Voucher code: ${code}\nLogin: ${loginUrl}`)}&text=${encodeURIComponent(`🎫 ${planName} WiFi voucher`)}` }],
                        [{ text: '🎫 Create Another', callback_data: 'process:voucher' }],
                        [{ text: '⬅️ Back to Menu', callback_data: 'process:start' }],
                    ]
                }
            }, { filename: 'voucher.png', contentType: 'image/png' });

        } catch (err) {
            logger.error('_createVoucher error:', err);
            const errText = `❌ Voucher creation failed: ${err.message}`;
            if (messageId) await this._safeEdit(chatId, messageId, errText);
            else await this.bot.sendMessage(chatId, errText);
        }
    }

    /**
     * Convert a plan's durationValue + durationUnit to a MikroTik limit-uptime string.
     * e.g. { durationValue: 1, durationUnit: 'hours' } → "01:00:00"
     */
    _durationToMikrotik(planObj) {
        if (!planObj?.durationValue || !planObj?.durationUnit) return null;
        const val = Number(planObj.durationValue);
        const unit = String(planObj.durationUnit).toLowerCase();
        if (unit === 'hours') return `${String(val).padStart(2, '0')}:00:00`;
        if (unit === 'days') return `${val * 24}:00:00`;
        if (unit === 'weeks') return `${val * 7 * 24}:00:00`;
        if (unit === 'minutes') return `00:${String(val).padStart(2, '0')}:00`;
        return null;
    }

    /**
     * Admin bulk voucher creation flow.
     * Stages:
     *   bulk:pick            → show plan picker
     *   bulk:<planId>        → show quantity picker
     *   bulk:<planId>:<qty>  → generate N vouchers, post list
     */
    async _handleBulkVoucher(chatId, action, extra, messageId, query) {
        // Guard: admin/reseller only
        const { getDatabase } = require('../database');
        const db = await getDatabase();
        const user = await db.getUser(chatId);
        const isStaff = user?.role === 'admin' || user?.role === 'reseller';
        if (!isStaff) {
            const txt = '🚫 Bulk creation is for admins and resellers only.';
            if (messageId) return this._safeEdit(chatId, messageId, txt);
            return this.bot.sendMessage(chatId, txt);
        }

        const BACK = [{ text: '⬅️ Back', callback_data: 'process:voucher' }];

        // ── Stage 1: plan picker ──────────────────────────────────────────────
        if (action === 'pick') {
            let plans = await db.getPlans(true).catch(() => []);
            if (!plans.length) {
                const { DEFAULT_PLANS } = require('../database');
                plans = Object.values(DEFAULT_PLANS).filter(p => p.active !== false);
            }
            const wallet = await db.getWallet(chatId);
            const currency = wallet.currency || 'USD';

            const rows = plans.map(p => {
                const dur = p.durationValue && p.durationUnit
                    ? `${p.durationValue}${p.durationUnit[0]}` : '∞';
                const priceStr = (p.price > 0) ? `${p.price} ${currency}` : 'Free';
                const pid = p.mikrotikProfile || p.id || p.name;
                return [{ text: `📦 ${p.name}  ·  ${dur}  ·  ${priceStr}`, callback_data: `bulk:${pid}` }];
            });
            rows.push([BACK[0]]);
            const text = `📦 *Bulk Voucher Creation*\n\nSelect a plan:`;
            if (messageId) return this._safeEdit(chatId, messageId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
            return this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
        }

        // ── Stage 2: quantity picker (action = planId, extra = '') ───────────
        if (action && !extra) {
            const planId = action;
            const rows = [
                [{ text: '5 vouchers', callback_data: `bulk:${planId}:5` },
                { text: '10 vouchers', callback_data: `bulk:${planId}:10` }],
                [{ text: '20 vouchers', callback_data: `bulk:${planId}:20` },
                { text: '50 vouchers', callback_data: `bulk:${planId}:50` }],
                [BACK[0]],
            ];
            const text = `📦 *Bulk Create — ${planId}*\n\nHow many vouchers?`;
            if (messageId) return this._safeEdit(chatId, messageId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
            return this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
        }

        // ── Stage 3: generate batch (action = planId, extra = qty) ──────────
        const planId = action;
        const qty = Math.min(Math.max(parseInt(extra, 10) || 5, 1), 100);

        const progText = `⏳ *Generating ${qty} × ${planId} vouchers...*`;
        let progMsgId = messageId;
        if (progMsgId) await this._safeEdit(chatId, progMsgId, progText, { parse_mode: 'Markdown' });
        else {
            const s = await this.bot.sendMessage(chatId, progText, { parse_mode: 'Markdown' });
            progMsgId = s.message_id;
        }

        // Resolve plan
        let planObj = await db.getPlan(planId).catch(() => null);
        if (!planObj) {
            // Fallback for custom or unmatched plans
            planObj = { name: planId, mikrotikProfile: planId, durationUnit: 'days', durationValue: 1, deviceLimit: 1, price: 0 };
        }

        const wallet = await db.getWallet(chatId);
        const currency = wallet.currency || 'USD';

        const profile = planObj.mikrotikProfile || planId;
        const mt = this.mikrotik || global.mikrotik || null;
        const voucherAgent = require('../voucher');

        let expiresAt = null;
        try {
            const UniversalBilling = require('../universal-billing');
            expiresAt = new UniversalBilling().calculateExpiry(planObj);
        } catch (_) { /* expiry stays null if this fails */ }

        const codes = [];
        const errors = [];

        for (let i = 0; i < qty; i++) {
            const code = await voucherAgent.generate(profile);
            try {
                await db.createVoucher(code, {
                    plan: profile, planName: planObj.name || planId,
                    durationUnit: planObj.durationUnit || null,
                    durationValue: planObj.durationValue || null,
                    deviceLimit: planObj.deviceLimit || 1,
                    expiresAt,
                    createdBy: String(chatId),
                    value: Number(planObj.price || 0),
                    currency: currency,
                });
                if (mt) {
                    await mt.addHotspotUser({
                        username: code, password: code, profile,
                        sharedUsers: planObj.deviceLimit || 1,
                    }).catch(e => errors.push(`${code}: ${e.message}`));
                }
                codes.push(code);
            } catch (e) {
                errors.push(`${code}: ${e.message}`);
            }
        }

        // Delete progress message
        await this.bot.deleteMessage(chatId, progMsgId).catch(() => { });

        // Format and send the code list (split into chunks of 4096 if needed)
        const durationLabel = planObj.durationUnit
            ? `${planObj.durationValue} ${planObj.durationUnit}` : 'Unlimited';
        const header =
            `📦 *Bulk Voucher Report*\n` +
            `Plan: *${planObj.name || planId}*  ·  Duration: *${durationLabel}*\n` +
            `Generated: *${codes.length}/${qty}*${errors.length ? `  ·  ⚠️ ${errors.length} error(s)` : ''}\n\n`;
        const codeBlock = codes.map((c, i) => `${String(i + 1).padStart(3, ' ')}. \`${c}\``).join('\n');
        const footer = `\n\n_Codes are active on the router. Share as needed._`;
        const full = header + codeBlock + footer;

        // Telegram max caption is 4096 chars; chunk if needed
        const MAX = 4096;
        if (full.length <= MAX) {
            await this.bot.sendMessage(chatId, full, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📦 Create More', callback_data: 'bulk:pick' }],
                        [{ text: '⬅️ Back to Menu', callback_data: 'process:start' }],
                    ]
                },
            });
        } else {
            await this.bot.sendMessage(chatId, header + '_(codes below)_', { parse_mode: 'Markdown' });
            for (let start = 0; start < codeBlock.length; start += MAX) {
                await this.bot.sendMessage(chatId, '```\n' + codeBlock.slice(start, start + MAX) + '\n```', { parse_mode: 'Markdown' });
            }
            await this.bot.sendMessage(chatId, footer.trim(), {
                parse_mode: 'Markdown', reply_markup: {
                    inline_keyboard: [
                        [{ text: '📦 Create More', callback_data: 'bulk:pick' }],
                        [{ text: '⬅️ Back to Menu', callback_data: 'process:start' }],
                    ]
                }
            });
        }

        if (errors.length) {
            logger.warn(`Bulk voucher errors (${errors.length}): ${errors.join('; ')}`);
        }
    }


    _formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }

    _truncate(str, len = 2000) {
        if (!str) return '';
        if (str.length <= len) return str;
        return str.substring(0, len) + '... (truncated)';
    }

    _clearOldCache() {
        const now = Date.now();
        for (const [key, value] of this.messageCache.entries()) {
            if (now - value.timestamp > 300_000) this.messageCache.delete(key);
        }
    }

    async _sendAllUsers(chatId, opts = {}) {
        if (!this.mikrotik) return this.bot.sendMessage(chatId, '⚠️ MikroTik not connected.');
        const showRemove = opts.showRemove || false;
        try {
            const users = await (this.mikrotik.getAllHotspotUsers?.() || this.mikrotik.executeTool('users.all'));
            if (!users?.length) {
                const noUsersText = '👥 No hotspot users found.';
                if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, noUsersText);
                return this.bot.sendMessage(chatId, noUsersText);
            }

            let msg = `📋 *All Hotspot Users: ${users.length}*\n\n`;
            const keyboard = [];
            users.slice(0, 20).forEach((u, i) => {
                const name = u.name || 'Unknown';
                const profile = u.profile || 'default';
                const disabled = u.disabled === 'true' ? ' 🔒' : '';
                msg += `${i + 1}. *${name}* — \`${profile}\`${disabled}\n`;
                if (showRemove) {
                    keyboard.push([{ text: `🗑 Remove ${name}`, callback_data: `users:doremove:${name}` }]);
                } else {
                    keyboard.push([
                        { text: `✏️ ${name}`, callback_data: `users:doedit:${name}` },
                        { text: `❌ Kick`, callback_data: `kick:${name}` }
                    ]);
                }
            });
            if (users.length > 20) msg += `\n_+${users.length - 20} more…_`;
            keyboard.push([{ text: '⬅️ Back', callback_data: 'process:users' }]);

            const options = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } };
            if (opts.editMessageId) await this._safeEdit(chatId, opts.editMessageId, msg, options);
            else await this.bot.sendMessage(chatId, msg, options);
        } catch (err) {
            const errText = `❌ User error: ${err.message}`;
            if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, errText);
            await this.bot.sendMessage(chatId, errText);
        }
    }

    async _sendProfiles(chatId, opts = {}) {
        if (!this.mikrotik) return this.bot.sendMessage(chatId, '⚠️ MikroTik not connected.');
        try {
            const profiles = await (this.mikrotik.getHotspotProfiles?.() || this.mikrotik.executeTool('profile.list'));
            if (!profiles?.length) {
                const text = '📊 No hotspot profiles found.';
                if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, text);
                return this.bot.sendMessage(chatId, text);
            }
            let msg = `📊 *Hotspot Profiles: ${profiles.length}*\n\n`;
            profiles.forEach((p, i) => {
                msg += `${i + 1}. *${p.name || p.id}*`;
                if (p.rateLimit) msg += ` — \`${p.rateLimit}\``;
                if (p.sharedUsers) msg += ` | 👤×${p.sharedUsers}`;
                msg += '\n';
            });
            const options = {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'process:users' }]] }
            };
            if (opts.editMessageId) await this._safeEdit(chatId, opts.editMessageId, msg, options);
            else await this.bot.sendMessage(chatId, msg, options);
        } catch (err) {
            const errText = `❌ Profiles error: ${err.message}`;
            if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, errText);
            await this.bot.sendMessage(chatId, errText);
        }
    }

    /**
     * Prompt admin for edit params, or jump straight to edit if username pre-filled.
     * Called from: users:edit button (no username) or users:doedit:<username> per-user button.
     */
    async _editUserFlow(chatId, messageId, username = null) {
        if (!username) {
            // Generic edit — ask for full spec
            return this.promptUser(chatId,
                '✏️ *Edit Hotspot User*\nEnter: `username [newpassword] [newprofile]`\nExample: `john secret 1Day`\n\n_Omit fields to keep unchanged._',
                'users:doedit'
            );
        }
        // Per-user edit — pre-fill username in prompt
        return this.promptUser(chatId,
            `✏️ *Edit ${username}*\nEnter: \`[newpassword] [newprofile]\` (space-separated)\nExample: \`secret 1Day\`\n\n_Leave blank to cancel._`,
            `users:doeditnamed:${username}`
        );
    }

    async _doEditUser(chatId, rawInput, prefillUsername = null) {
        if (!this.mikrotik) return this.bot.sendMessage(chatId, '⚠️ MikroTik not connected.');
        const parts = rawInput.trim().split(/\s+/);

        let username, password, profile;
        if (prefillUsername) {
            // Input is: [password] [profile]
            username = prefillUsername;
            password = parts[0] || null;
            profile = parts[1] || null;
        } else {
            // Input is: username [password] [profile]
            [username, password, profile] = parts;
        }

        if (!username) return this.bot.sendMessage(chatId, '❌ Username required.');
        if (!password && !profile) return this.bot.sendMessage(chatId, '❌ Provide at least a new password or profile.');

        try {
            const result = await (this.mikrotik.editHotspotUser?.({ username, password, profile }) ||
                this.mikrotik.executeTool('user.edit', { username, password, profile }));

            const text = result?.updated
                ? `✅ *User Updated*\n\n👤 Username: \`${username}\`\n🔑 Fields: \`${result.fields?.join(', ')}\``
                : `ℹ️ Nothing changed for \`${username}\` — ${result?.reason || 'no-op.'}`;

            await this.bot.sendMessage(chatId, text, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to Users', callback_data: 'process:users' }]] }
            });
        } catch (err) {
            await this.bot.sendMessage(chatId, `❌ Edit failed: ${err.message}`);
        }
    }

    async _doRemoveUser(chatId, username, opts = {}) {
        if (!this.mikrotik) return this.bot.sendMessage(chatId, '⚠️ MikroTik not connected.');
        if (!username) return this.bot.sendMessage(chatId, '❌ Username required.');
        try {
            await (this.mikrotik.removeHotspotUser?.(username) || this.mikrotik.executeTool('user.remove', { username }));
            const text = `🗑 *User Removed:* \`${username}\``;
            const options = {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to Users', callback_data: 'process:users' }]] }
            };
            if (opts.editMessageId) await this._safeEdit(chatId, opts.editMessageId, text, options);
            else await this.bot.sendMessage(chatId, text, options);
        } catch (err) {
            const errText = `❌ Remove failed: ${err.message}`;
            if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, errText);
            await this.bot.sendMessage(chatId, errText);
        }
    }

    async _sendInterfaces(chatId, opts = {}) {
        if (!this.mikrotik) return this.bot.sendMessage(chatId, '⚠️ MikroTik not connected.');
        try {
            const ifaces = await (this.mikrotik.getInterfaces?.() || this.mikrotik.executeTool('interface.list'));
            let msg = `📊 *Network Interfaces*\n\n`;
            ifaces.forEach(i => {
                const status = i.running === 'true' || i.running === true ? '🟢' : '🔴';
                msg += `${status} *${i.name}* (${i.type})\n`;
            });
            const reply_markup = { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'process:network' }]] };
            if (opts.editMessageId) {
                await this._safeEdit(chatId, opts.editMessageId, msg, { parse_mode: 'Markdown', reply_markup });
            } else {
                await this.bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', reply_markup });
            }
        } catch (err) {
            await this.bot.sendMessage(chatId, `❌ Interface error: ${err.message}`);
        }
    }

    async _sendDhcpLeases(chatId, opts = {}) {
        if (!this.mikrotik) return this.bot.sendMessage(chatId, '⚠️ MikroTik not connected.');
        try {
            const leases = await (this.mikrotik.getDhcpLeases?.() || this.mikrotik.executeTool('dhcp.leases'));
            let msg = `📋 *DHCP Leases: ${leases?.length || 0}*\n\n`;
            leases?.slice(0, 15).forEach((l, i) => {
                msg += `${i + 1}. *${l.address}* — ${l['host-name'] || 'Unknown'}\n`;
            });
            const reply_markup = { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'process:network' }]] };
            if (opts.editMessageId) {
                await this._safeEdit(chatId, opts.editMessageId, msg, { parse_mode: 'Markdown', reply_markup });
            } else {
                await this.bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', reply_markup });
            }
        } catch (err) {
            await this.bot.sendMessage(chatId, `❌ DHCP error: ${err.message}`);
        }
    }

    async _sendFirewallRules(chatId, opts = {}) {
        if (!this.mikrotik) return this.bot.sendMessage(chatId, '⚠️ MikroTik not connected.');
        try {
            const rules = await (this.mikrotik.getFirewallRules?.() || this.mikrotik.executeTool('firewall.list'));
            let msg = `🔥 *Firewall Rules*\n\n`;
            rules?.slice(0, 10).forEach((r, i) => {
                msg += `${i + 1}. [${r.chain}] ${r.action} — ${r['src-address'] || 'any'}\n`;
            });
            msg += `\n_Showing first 10 rules._`;
            const reply_markup = { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'process:network' }]] };
            if (opts.editMessageId) {
                await this._safeEdit(chatId, opts.editMessageId, msg, { parse_mode: 'Markdown', reply_markup });
            } else {
                await this.bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', reply_markup });
            }
        } catch (err) {
            const errText = `❌ Firewall error: ${err.message}`;
            if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, errText);
            await this.bot.sendMessage(chatId, errText);
        }
    }

    async _sendConnections(chatId, opts = {}) {
        if (!this.mikrotik) return this.bot.sendMessage(chatId, '⚠️ MikroTik not connected.');
        try {
            const conns = await (this.mikrotik.getActiveConnections?.() || this.mikrotik.executeTool('firewall.connections'));
            let msg = `🔗 *Active Connections: ${conns?.length || 0}*\n\n`;
            conns?.slice(0, 12).forEach((c, i) => {
                msg += `${i + 1}. *${c['src-address']}* ➔ *${c['dst-address']}*\n   [${c.protocol}] ${c['orig-rate'] || '0bps'}\n`;
            });
            const reply_markup = { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'process:network' }]] };
            if (opts.editMessageId) {
                await this._safeEdit(chatId, opts.editMessageId, msg, { parse_mode: 'Markdown', reply_markup });
            } else {
                await this.bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', reply_markup });
            }
        } catch (err) {
            const errText = `❌ Connection error: ${err.message}`;
            if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, errText);
            await this.bot.sendMessage(chatId, errText);
        }
    }

    async _sendHealth(chatId, opts = {}) {
        if (!this.mikrotik) return this.bot.sendMessage(chatId, '⚠️ MikroTik not connected.');
        try {
            const health = await (this.mikrotik.getSystemHealth?.() || this.mikrotik.executeTool('system.health'));
            let msg = `🌡 *System Health*\n\n`;
            if (health && typeof health === 'object') {
                Object.entries(health).forEach(([key, val]) => {
                    msg += `• *${key}:* \`${val}\`\n`;
                });
            } else {
                msg += `_No health sensors detected._`;
            }
            const reply_markup = { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'process:network' }]] };
            if (opts.editMessageId) {
                await this._safeEdit(chatId, opts.editMessageId, msg, { parse_mode: 'Markdown', reply_markup });
            } else {
                await this.bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', reply_markup });
            }
        } catch (err) {
            const errText = `❌ Health error: ${err.message}`;
            if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, errText);
            await this.bot.sendMessage(chatId, errText);
        }
    }

    async _sendLogs(chatId, opts = {}) {
        if (!this.mikrotik) return this.bot.sendMessage(chatId, '⚠️ MikroTik not connected.');
        try {
            const logs = await (this.mikrotik.getLogs?.() || this.mikrotik.executeTool('system.logs', { count: 15 }));
            let msg = `📜 *System Logs (Last 15)*\n\n`;
            logs?.forEach(l => {
                const emoji = l.topics?.includes('error') ? '🔴' : l.topics?.includes('warning') ? '🟡' : '⚪';
                msg += `${emoji} \`${l.time}\` [${l.topics}] ${l.message}\n`;
            });
            const reply_markup = { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'process:network' }]] };
            const text = this._truncate(msg, 3900);
            if (opts.editMessageId) {
                await this._safeEdit(chatId, opts.editMessageId, text, { parse_mode: 'Markdown', reply_markup });
            } else {
                await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup });
            }
        } catch (err) {
            const errText = `❌ Logs error: ${err.message}`;
            if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, errText);
            await this.bot.sendMessage(chatId, errText);
        }
    }

    async _sendNeighbors(chatId, opts = {}) {
        if (!this.mikrotik) return this.bot.sendMessage(chatId, '⚠️ MikroTik not connected.');
        try {
            const neighbors = await (this.mikrotik.getNeighbors?.() || this.mikrotik.executeTool('system.neighbors'));
            let msg = `🔍 *Network Neighbors: ${neighbors?.length || 0}*\n\n`;
            neighbors?.forEach((n, i) => {
                msg += `${i + 1}. *${n.identity || n['device-id']}*\n   📍 ${n.address || 'N/A'} (${n.interface})\n`;
            });
            const reply_markup = { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'process:network' }]] };
            if (opts.editMessageId) {
                await this._safeEdit(chatId, opts.editMessageId, msg, { parse_mode: 'Markdown', reply_markup });
            } else {
                await this.bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', reply_markup });
            }
        } catch (err) {
            const errText = `❌ Neighbors error: ${err.message}`;
            if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, errText);
            await this.bot.sendMessage(chatId, errText);
        }
    }

    async _handleTraceroute(msg, match, opts = {}) {
        const chatId = msg.chat.id;
        const host = match?.[1];
        if (!host) {
            return this.promptUser(chatId, '🛤 *Traceroute*\nPlease enter the destination host or IP:', 'tool:traceroute');
        }
        // If host provided, call _handleTool directly
        await this._handleTool(msg, [null, 'traceroute', host], opts);
    }

    async _doReboot(chatId, opts = {}) {
        if (!this.mikrotik) {
            const errText = '⚠️ MikroTik not connected.';
            if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, errText);
            return this.bot.sendMessage(chatId, errText);
        }
        const text = '⚙️ `[ Sending reboot command... ]`';
        console.log('_doReboot mikrotik:', this.mikrotik);
        if (opts.editMessageId) await this._safeEdit(chatId, opts.editMessageId, text, { parse_mode: 'Markdown' });
        else await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });

        try {
            await (this.mikrotik.reboot?.() || this.mikrotik.executeTool('system.reboot'));
            const successText = '✅ *Reboot Sent!* The router is restarting. Notifications will resume once it is back online.';
            console.log(this.mikrotik.executeTool);
            if (opts.editMessageId) await this._safeEdit(chatId, opts.editMessageId, successText);
            else await this.bot.sendMessage(chatId, successText);
        } catch (err) {
            const errText = `❌ Reboot failed: ${err.message}`;
            if (opts.editMessageId) await this._safeEdit(chatId, opts.editMessageId, errText);
            else await this.bot.sendMessage(chatId, errText);
        }
    }

    async _doKick(chatId, username, opts = {}) {
        if (!this.mikrotik) {
            const errText = '⚠️ MikroTik not connected.';
            if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, errText);
            return this.bot.sendMessage(chatId, errText);
        }
        try {
            const res = await (this.mikrotik.kickUser?.(username) || this.mikrotik.executeTool('user.kick', { target: username }));
            const text = `✅ *User Kicked:* ${username}\nAddress: ${res?.address || 'N/A'}`;
            const options = {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to Users', callback_data: 'process:users' }]] }
            };
            if (opts.editMessageId) await this._safeEdit(chatId, opts.editMessageId, text, options);
            else await this.bot.sendMessage(chatId, text, options);
        } catch (err) {
            const errText = `❌ Kick failed: ${err.message}`;
            if (opts.editMessageId) await this._safeEdit(chatId, opts.editMessageId, errText);
            else await this.bot.sendMessage(chatId, errText);
        }
    }


    async _sendIpAddresses(chatId, opts = {}) {
        if (!this.mikrotik) return this.bot.sendMessage(chatId, '⚠️ MikroTik not connected.');
        try {
            const ips = await (this.mikrotik.getIpAddresses?.() || this.mikrotik.executeTool('ip.addresses'));
            let msg = `🌐 *IP Addresses*\n\n`;
            ips?.forEach(i => {
                msg += `• *${i.address}* (${i.interface})\n`;
            });
            const reply_markup = { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'process:network' }]] };
            if (opts.editMessageId) {
                await this._safeEdit(chatId, opts.editMessageId, msg, { parse_mode: 'Markdown', reply_markup });
            } else {
                await this.bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', reply_markup });
            }
        } catch (err) {
            const errText = `❌ IP error: ${err.message}`;
            if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, errText);
            await this.bot.sendMessage(chatId, errText);
        }
    }

    async _sendDns(chatId, opts = {}) {
        if (!this.mikrotik) return this.bot.sendMessage(chatId, '⚠️ MikroTik not connected.');
        try {
            const dns = await (this.mikrotik.getDnsSettings?.() || this.mikrotik.executeTool('dns'));
            let msg = `🏷 *DNS Settings*\n\n` +
                `Servers: \`${dns.servers || 'none'}\`\n` +
                `Dynamic: \`${dns['dynamic-servers'] || 'none'}\`\n` +
                `Allow Remote: \`${dns['allow-remote-requests']}\`\n`;

            const reply_markup = { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'process:network' }]] };
            if (opts.editMessageId) {
                await this._safeEdit(chatId, opts.editMessageId, msg, { parse_mode: 'Markdown', reply_markup });
            } else {
                await this.bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', reply_markup });
            }
        } catch (err) {
            const errText = `❌ DNS error: ${err.message}`;
            if (opts.editMessageId) return this._safeEdit(chatId, opts.editMessageId, errText);
            await this.bot.sendMessage(chatId, errText);
        }
    }

    // destroy() is defined above at class initialization — using releaseBotLock()
    // The duplicate here has been removed to avoid LOCK_FILE undefined reference.

    async _handleTransfer(msg, match) {
        const chatId = msg.chat.id;
        const identifier = match[1];
        const planId = match[2];

        const { getDatabase } = require('../database');
        const db = await getDatabase();
        const currentUser = await db.getUser(msg._uid || chatId);
        const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'reseller';

        if (!isAdmin) return this.bot.sendMessage(chatId, '❌ *Access Denied:* Admin required.');
        if (!identifier) return this.bot.sendMessage(chatId, '❌ Usage: `/transfer <user> [planId]`');

        try {
            const targetUser = await db.resolveUser(identifier);
            if (!targetUser) return this.bot.sendMessage(chatId, `❌ User *${identifier}* not found.`);

            let selectedPlan = planId;
            if (!selectedPlan) {
                return this.bot.sendMessage(chatId, `❌ Please specify a plan ID. Example: \`/transfer ${identifier} 1Day\``);
            }

            const plans = await db.getPlans();
            const plan = plans.find(p => p.mikrotikProfile === selectedPlan || p.id === selectedPlan);
            if (!plan) return this.bot.sendMessage(chatId, `❌ Plan *${selectedPlan}* not found.`);

            const voucherAgent = require('../voucher');
            const code = await voucherAgent.generate(selectedPlan);

            await db.createVoucher(code, {
                plan: selectedPlan,
                duration: plan.durationValue ? `${plan.durationValue}${plan.durationUnit || ''}` : '24h',
                userId: targetUser.id,
                createdAt: new Date(),
                createdBy: `telegram:${chatId}`
            });

            if (plan.price > 0) {
                await db.updateUser(targetUser.id, { credits: (targetUser.credits || 0) + plan.price });
                await db.logAudit('voucher.transfer', `telegram:${chatId}`, { targetId: targetUser.id, code, price: plan.price });
            }

            const text = `🎁 *Transfer Success*\n\n` +
                `Recipient: *${targetUser.fullname || targetUser.username || targetUser.id}*\n` +
                `Plan: *${plan.name}*\n` +
                `Code: \`${code}\`\n\n` +
                `_The user has been credited and can now use this voucher._`;

            await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });

            if (targetUser.channels?.telegram) {
                this.bot.sendMessage(targetUser.channels.telegram, `🎁 *Gift Received!*\nYou have been sent a *${plan.name}* voucher.\nCode: \`${code}\``, { parse_mode: 'Markdown' }).catch(() => {});
            }
        } catch (err) {
            this.bot.sendMessage(chatId, `❌ Transfer failed: ${err.message}`);
        }
    }
}

BaseChannel.register('telegram', TelegramChannel);

export default TelegramChannel;
