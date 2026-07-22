#!/usr/bin/env node
// ============================================================
// AgentOS — Network Intelligence Platform
// Version : 2026.3.30
// Stack   : MikroTik RouterOS · Telegram · WebSocket CLI
//           Firebase/Local DB · Gemini 2.5 ReAct Engine
// Security: CVE-2026-1526 patched · WS leak-free · Firebase v13
// ============================================================
process.env.GRPC_DNS_RESOLVER = 'native';

// ── Dependencies ─────────────────────────────────────────────
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const WebSocket = require('ws');
const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
const { RouterOSClient } = require('routeros-client');
const QRCode = require('qrcode');
const admin = require('firebase-admin');
const winston = require('winston');
const Joi = require('joi');
const fs = require('fs');
const readline = require('readline');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

// Ensure log directory exists before Winston initialises
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const ARGS = process.argv.slice(2);
const IS_CLI = ARGS[0] === 'cli';

// ============================================================
// §1  CONSTANTS & CONFIG
// ============================================================

const BRAND = {
    name: 'AgentOS',
    version: '2026.3.30',
    emoji: '🤖',
    tagline: 'Network Intelligence, Simplified',
};

// ── Environment schema ───────────────────────────────────────
const envSchema = Joi.object({
    MIKROTIK_PASS: Joi.string().required(),
    TELEGRAM_TOKEN: Joi.string().allow('').default(''),
    TELEGRAM_BOT_USERNAME: Joi.string().default('AgentOSBot'),
    MIKROTIK_IP: Joi.string().default('192.168.88.1'),
    MIKROTIK_USER: Joi.string().default('admin'),
    MIKROTIK_PORT: Joi.number().default(8728),
    GATEWAY_PORT: Joi.number().default(19876),
    GATEWAY_HOST: Joi.string().default('127.0.0.1'),
    PORT: Joi.number().default(3000),
    HOST: Joi.string().default('0.0.0.0'),
    NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
    ALLOWED_CHAT_IDS: Joi.string().allow('').default(''),
    FIREBASE_PROJECT_ID: Joi.string().allow('').default(''),
    FIREBASE_PRIVATE_KEY: Joi.string().allow('').default(''),
    FIREBASE_CLIENT_EMAIL: Joi.string().allow('').default(''),
    SERVER_URL: Joi.string().uri().default('http://localhost:3000'),
    ALLOWED_ORIGINS: Joi.string().default('*'),
    GEMINI_API_KEY: Joi.string().allow('').default(''),
    AGENTOS_GATEWAY_TOKEN: Joi.string().allow('').default(''),
}).unknown(true);

const { error: envError, value: ENV } = envSchema.validate(process.env);
if (envError) { console.error(`[AgentOS] ENV error: ${envError.message}`); process.exit(1); }

const CONFIG = {
    MIKROTIK: {
        IP: ENV.MIKROTIK_IP,
        USER: ENV.MIKROTIK_USER,
        PASS: ENV.MIKROTIK_PASS,
        PORT: ENV.MIKROTIK_PORT,
        RECONNECT_INTERVAL: 5000,
        MAX_RECONNECT: 10,
    },
    TELEGRAM: {
        TOKEN: ENV.TELEGRAM_TOKEN,
        ALLOWED_CHATS: ENV.ALLOWED_CHAT_IDS
            ? ENV.ALLOWED_CHAT_IDS.split(',').filter(Boolean)
            : [],
        BOT_USERNAME: ENV.TELEGRAM_BOT_USERNAME,
    },
    GATEWAY: {
        PORT: ENV.GATEWAY_PORT,
        HOST: ENV.GATEWAY_HOST,
        TOKEN: ENV.AGENTOS_GATEWAY_TOKEN || crypto.randomBytes(32).toString('hex'),
        WS_PATH: '/ws',
    },
    SERVER: {
        PORT: ENV.PORT,
        HOST: ENV.HOST,
        NODE_ENV: ENV.NODE_ENV,
    },
    SECURITY: {
        RATE_LIMIT_WINDOW: 15 * 60 * 1000,
        RATE_LIMIT_MAX: 100,
        VOUCHER_RATE_LIMIT: 5,
        VOUCHER_WINDOW_MS: 60 * 1000,
        ALERT_COOLDOWN_MS: 5 * 60 * 1000,
    },
    VOUCHER_PREFIX: 'STAR-',
    VOUCHER_PLANS: {
        '1hour': { maxAgeMs: 60 * 60 * 1000 },
        '1Day': { maxAgeMs: 24 * 60 * 60 * 1000 },
        '7Day': { maxAgeMs: 7 * 24 * 60 * 60 * 1000 },
        '30Day': { maxAgeMs: 30 * 24 * 60 * 60 * 1000 },
    },
};

if (!CONFIG.MIKROTIK.PASS) throw new Error('MIKROTIK_PASS required');

// ── Gemini AI ────────────────────────────────────────────────
const genAI = ENV.GEMINI_API_KEY ? new GoogleGenerativeAI(ENV.GEMINI_API_KEY) : null;

// ============================================================
// §2  LOGGER
// ============================================================

const logTransports = [
    new winston.transports.File({
        filename: path.join(logDir, 'error.log'), level: 'error',
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    }),
    new winston.transports.File({
        filename: path.join(logDir, 'combined.log'),
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    }),
];

if (!IS_CLI) {
    logTransports.push(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ level, message, timestamp }) =>
                `${BRAND.emoji} [${BRAND.name}] ${timestamp} ${level}: ${message}`
            ),
        ),
    }));
}

const logger = winston.createLogger({
    level: CONFIG.SERVER.NODE_ENV === 'production' ? 'info' : 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
    ),
    transports: logTransports,
    exitOnError: false,
});

// ============================================================
// §3  UTILITIES
// ============================================================

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const uid = () => crypto.randomUUID();
const voucherCode = () => CONFIG.VOUCHER_PREFIX + crypto.randomBytes(3).toString('hex').toUpperCase();

function fmtBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024, units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
    return `${(bytes / k ** i).toFixed(2)} ${units[i]}`;
}

function fmtUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}

function truncate(s, max = 3500) {
    if (!s) return '';
    return s.length > max ? s.slice(0, max) + '\n…(truncated)' : s;
}

// ── ANSI palette ─────────────────────────────────────────────
const A = {
    RESET: '\x1b[0m', BOLD: '\x1b[1m', DIM: '\x1b[2m',
    PRIMARY: '\x1b[38;5;39m',
    SUCCESS: '\x1b[32m',
    ERROR: '\x1b[31m',
    WARN: '\x1b[33m',
    INFO: '\x1b[34m',
    NEON_CYAN: '\x1b[38;5;51m',
    CYBER_PURPLE: '\x1b[38;5;135m',
};

// ── Terminal animator (CLI-only) ─────────────────────────────
const TerminalAnimator = {
    async showSpinner(message, durationMs) {
        const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        const end = Date.now() + durationMs;
        let i = 0;
        process.stdout.write('  ');
        while (Date.now() < end) {
            process.stdout.write(`\r  ${A.CYBER_PURPLE}${frames[i % frames.length]}${A.RESET} ${message}`);
            await sleep(80);
            i++;
        }
        process.stdout.write(`\r  ${A.SUCCESS}✔${A.RESET} ${message}\n`);
    },
    async typewriter(text, speed = 15) {
        process.stdout.write('  ');
        for (const ch of text) { process.stdout.write(ch); await sleep(speed); }
        console.log();
    },
    printHeader(title) {
        const bar = `${A.DIM}${'━'.repeat(48)}${A.RESET}`;
        console.log(`\n${bar}\n  ${A.BOLD}${A.PRIMARY}${title}${A.RESET}\n${bar}\n`);
    },
};

// ============================================================
// §4  METRICS
// ============================================================

class Metrics {
    constructor() {
        this.startedAt = Date.now();
        this.requests = 0;
        this.errors = 0;
        this.toolInvocations = 0;
        this.vouchersCreated = 0;
        this.vouchersRedeemed = 0;
        this.wsMessages = 0;
        this.alertsFired = 0;
    }
    snapshot() {
        return {
            uptime: Math.floor((Date.now() - this.startedAt) / 1000),
            requests: this.requests,
            errors: this.errors,
            toolInvocations: this.toolInvocations,
            vouchersCreated: this.vouchersCreated,
            vouchersRedeemed: this.vouchersRedeemed,
            wsMessages: this.wsMessages,
            alertsFired: this.alertsFired,
        };
    }
}
const metrics = new Metrics();

// ============================================================
// §5  DATABASE (Firebase + Local fallback)
// ============================================================

class Database {
    constructor() {
        this.db = null;   // Firestore instance or null
        this._local = new Map();
        this._init();
    }

    _init() {
        if (!ENV.FIREBASE_PROJECT_ID) {
            logger.warn('Firebase not configured — using local storage');
            this._loadLocal();
            return;
        }
        try {
            // Normalise escaped newlines that some env managers produce
            let key = (ENV.FIREBASE_PRIVATE_KEY || '')
                .replace(/\\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

            if (!admin.apps.length) {
                admin.initializeApp({
                    credential: admin.credential.cert({
                        projectId: ENV.FIREBASE_PROJECT_ID,
                        privateKey: key,
                        clientEmail: ENV.FIREBASE_CLIENT_EMAIL,
                    }),
                });
            }
            this.db = admin.firestore();
            logger.info('Firebase initialised');
        } catch (err) {
            logger.error(`Firebase init failed (${err.message}) — falling back to local`);
            this._loadLocal();
        }
    }

    _loadLocal() {
        try {
            if (fs.existsSync('./data/vouchers.json')) {
                const raw = JSON.parse(fs.readFileSync('./data/vouchers.json', 'utf8'));
                for (const [k, v] of Object.entries(raw)) this._local.set(k, v);
            }
        } catch { /* first run */ }
    }

    _saveLocal() {
        if (this.db) return;
        try {
            if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
            fs.writeFileSync('./data/vouchers.json',
                JSON.stringify(Object.fromEntries(this._local), null, 2));
        } catch (err) {
            logger.error('Local save failed:', err.message);
        }
    }

    _calcExpiry(plan, duration) {
        if (duration) {
            const m = duration.match(/^(\d+)([hd])$/);
            if (m) return new Date(Date.now() + m[1] * (m[2] === 'h' ? 3_600_000 : 86_400_000)).toISOString();
        }
        const ms = CONFIG.VOUCHER_PLANS[plan]?.maxAgeMs;
        return ms ? new Date(Date.now() + ms).toISOString() : null;
    }

    async getVoucher(code) {
        if (this.db) {
            const doc = await this.db.collection('vouchers').doc(code).get();
            return doc.exists ? { id: doc.id, ...doc.data() } : null;
        }
        const v = this._local.get(code);
        return v ? { id: code, ...v } : null;
    }

    async createVoucher(code, data) {
        const record = {
            ...data,
            createdAt: new Date().toISOString(),
            used: false,
            expiresAt: this._calcExpiry(data.plan, data.duration),
        };
        if (this.db) await this.db.collection('vouchers').doc(code).set(record);
        else { this._local.set(code, record); this._saveLocal(); }
        metrics.vouchersCreated++;
        return { id: code, ...record };
    }

    async redeemVoucher(code, userData) {
        const update = { used: true, redeemedAt: new Date().toISOString(), redeemedBy: userData };
        if (this.db) {
            await this.db.collection('vouchers').doc(code).update(update);
        } else {
            const v = this._local.get(code);
            if (v) { this._local.set(code, { ...v, ...update }); this._saveLocal(); }
        }
        metrics.vouchersRedeemed++;
    }

    async deleteVoucher(code) {
        if (this.db) await this.db.collection('vouchers').doc(code).delete();
        else { this._local.delete(code); this._saveLocal(); }
    }

    async listVouchers({ limit = 50, used } = {}) {
        let items;
        if (this.db) {
            let q = this.db.collection('vouchers').orderBy('createdAt', 'desc').limit(limit);
            if (used !== undefined) q = q.where('used', '==', used);
            items = (await q.get()).docs.map(d => ({ id: d.id, ...d.data() }));
        } else {
            items = [...this._local.entries()]
                .map(([id, d]) => ({ id, ...d }))
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, limit);
            if (used !== undefined) items = items.filter(v => v.used === used);
        }
        return items;
    }

    async getStats() {
        const all = await this.listVouchers({ limit: 10_000 });
        const now = Date.now();
        return {
            total: all.length,
            used: all.filter(v => v.used).length,
            active: all.filter(v => !v.used && (!v.expiresAt || new Date(v.expiresAt) > now)).length,
            expired: all.filter(v => !v.used && v.expiresAt && new Date(v.expiresAt) <= now).length,
        };
    }

    async expireOldVouchers() {
        const pending = await this.listVouchers({ limit: 10_000, used: false });
        const now = Date.now();
        let count = 0;
        for (const v of pending) {
            if (v.expiresAt && new Date(v.expiresAt) <= now) {
                await this.redeemVoucher(v.id, { reason: 'expired', expiredAt: new Date().toISOString() });
                if (mikrotik.isConnected) {
                    await mikrotik.removeHotspotUser(v.id).catch(() => { });
                    await mikrotik.kickUser(v.id).catch(() => { });
                }
                count++;
            }
        }
        return count;
    }
}
const database = new Database();

// ============================================================
// §6  ROUTEROS TOOLS REGISTRY
// ============================================================

const TOOLS = {
    'system.stats': async (c) => (await c.menu('/system/resource').get())[0],
    'system.logs': async (c, n = 10) => (await c.menu('/log').get()).slice(-n),
    'system.reboot': async (c) => { await c.menu('/system').exec('reboot'); return { status: 'rebooting' }; },
    'system.backup': async (c, name = 'AgentOS_Backup') => {
        await c.menu('/system/backup').exec('save', { name });
        return { action: 'backup_created', file: `${name}.backup` };
    },
    'users.active': async (c) => c.menu('/ip/hotspot/active').get(),
    'users.all': async (c) => c.menu('/ip/hotspot/user').get(),
    'user.add': async (c, username, password, profile = 'default') => {
        const existing = await c.menu('/ip/hotspot/user').where('name', username).get();
        if (existing.length > 0) {
            await c.menu('/ip/hotspot/user').update(existing[0]['.id'], { password, profile, disabled: 'no' });
            return { action: 'updated', username };
        }
        await c.menu('/ip/hotspot/user').add({ name: username, password, profile });
        return { action: 'created', username };
    },
    'user.remove': async (c, username) => {
        const users = await c.menu('/ip/hotspot/user').where('name', username).get();
        if (!users.length) throw new Error(`User not found: ${username}`);
        await c.menu('/ip/hotspot/user').remove(users[0]['.id']);
        return { action: 'removed', username };
    },
    'user.kick': async (c, username) => {
        const active = await c.menu('/ip/hotspot/active').where('user', username).get();
        if (active.length) { await c.menu('/ip/hotspot/active').remove(active[0]['.id']); return { kicked: true, username }; }
        return { kicked: false, username, reason: 'Not active' };
    },
    'user.status': async (c, username) => {
        const r = await c.menu('/ip/hotspot/active').where('user', username).get();
        return r.length ? r[0] : null;
    },
    'ping': async (c, host, count = 4) => c.menu('/ping').exec({ address: host, count: String(count) }),
    'traceroute': async (c, host) => c.menu('/tool/traceroute').exec({ address: host, count: '1' }),
    'dhcp.leases': async (c) => c.menu('/ip/dhcp-server/lease').get(),
    'interfaces': async (c) => c.menu('/interface').get(),
    'arp.table': async (c) => c.menu('/ip/arp').get(),
    'ip.routes': async (c) => c.menu('/ip/route').get(),
    'hotspot.profiles': async (c) => c.menu('/ip/hotspot/user/profile').get(),
    'dns.flush': async (c) => { await c.menu('/ip/dns/cache').exec('flush'); return { action: 'flushed', service: 'dns' }; },
    'firewall.list': async (c, type = 'filter') => c.menu(`/ip/firewall/${type}`).get(),
    'firewall.block': async (c, target, list = 'blocked') => {
        await c.menu('/ip/firewall/address-list').add({ list, address: target, comment: 'Blocked via AgentOS' });
        return { action: 'blocked', target };
    },
    'firewall.unblock': async (c, target, list = 'blocked') => {
        const entries = await c.menu('/ip/firewall/address-list').where('address', target).where('list', list).get();
        for (const e of entries) await c.menu('/ip/firewall/address-list').remove(e['.id']);
        return { action: 'unblocked', target, count: entries.length };
    },
};

// ============================================================
// §7  MIKROTIK MANAGER
// ============================================================

class MikroTikManager {
    constructor() {
        this.conn = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this._monitorTimer = null;

        this.api = new RouterOSClient({
            host: CONFIG.MIKROTIK.IP,
            user: CONFIG.MIKROTIK.USER,
            password: CONFIG.MIKROTIK.PASS,
            port: CONFIG.MIKROTIK.PORT,
            timeout: 10_000,
        });

        // Attach error handler — guard: routeros-client may not be a full EventEmitter
        if (typeof this.api.on === 'function') {
            this.api.on('error', (err) => {
                logger.warn(`RouterOSClient error: ${err.message}`);
                this.isConnected = false;
            });
        }
    }

    async connect() {
        try {
            this.conn = await this.api.connect();
            this.isConnected = true;
            this.reconnectAttempts = 0;
            logger.info(`MikroTik connected (${CONFIG.MIKROTIK.IP})`);
            if (!IS_CLI) this._startMonitor();
            return true;
        } catch (err) {
            this.isConnected = false;
            logger.error(`MikroTik connect failed: ${err.message}`);
            if (!IS_CLI) this._scheduleReconnect();
            throw err;
        }
    }

    disconnect() {
        if (this._monitorTimer) { clearInterval(this._monitorTimer); this._monitorTimer = null; }
        this.isConnected = false;
        try { this.api.close(); } catch { /* already closed */ }
        this.conn = null;
    }

    _startMonitor() {
        if (this._monitorTimer) clearInterval(this._monitorTimer);
        this._monitorTimer = setInterval(async () => {
            if (this.conn) {
                try { await this.conn.menu('/system/resource').get(); }
                catch {
                    logger.warn('MikroTik heartbeat failed — reconnecting…');
                    this.isConnected = false;
                    clearInterval(this._monitorTimer);
                    this._monitorTimer = null;
                    this.connect().catch(() => { });
                }
            }
        }, 30_000);
    }

    _scheduleReconnect() {
        if (this.reconnectAttempts >= CONFIG.MIKROTIK.MAX_RECONNECT) return;
        this.reconnectAttempts++;
        const delay = CONFIG.MIKROTIK.RECONNECT_INTERVAL * this.reconnectAttempts;
        setTimeout(() => this.connect().catch(() => { }), delay);
    }

    // Execute a named tool from the registry
    async executeTool(name, ...args) {
        const fn = TOOLS[name];
        if (!fn) throw new Error(`Unknown tool: ${name}`);
        if (!this.isConnected || !this.conn) throw new Error('MikroTik not connected');
        metrics.toolInvocations++;
        return fn(this.conn, ...args);
    }

    // Send a raw RouterOS CLI command via ssh-exec
    async executeCLI(command) {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        const res = await this.conn.write([
            '/system/ssh-exec',
            `=address=127.0.0.1`,
            `=user=${CONFIG.MIKROTIK.USER}`,
            `=command=${command}`,
        ]);
        return (res[0]?.output || 'OK').replace(/#/g, '');
    }

    // Send a raw RouterOS API command string
    async executeRawAPI(commandStr) {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        return this.conn.write(commandStr.trim().split(/\s+/));
    }

    availableTools() { return Object.keys(TOOLS); }
    getSystemStats() { return this.executeTool('system.stats'); }
    getLogs(n) { return this.executeTool('system.logs', n); }
    getActiveUsers() { return this.executeTool('users.active'); }
    getAllHotspotUsers() { return this.executeTool('users.all'); }
    addHotspotUser(u, p, pr) { return this.executeTool('user.add', u, p, pr); }
    removeHotspotUser(u) { return this.executeTool('user.remove', u); }
    kickUser(u) { return this.executeTool('user.kick', u); }
    getUserStatus(u) { return this.executeTool('user.status', u); }
    ping(h, c) { return this.executeTool('ping', h, c); }
    traceroute(h) { return this.executeTool('traceroute', h); }
    getDhcpLeases() { return this.executeTool('dhcp.leases'); }
    getInterfaces() { return this.executeTool('interfaces'); }
    getArpTable() { return this.executeTool('arp.table'); }
    getFirewallRules(t) { return this.executeTool('firewall.list', t); }
    addToBlockList(a, l) { return this.executeTool('firewall.block', a, l); }
    unblockAddress(a, l) { return this.executeTool('firewall.unblock', a, l); }
    reboot() { return this.executeTool('system.reboot'); }
}
const mikrotik = new MikroTikManager();

// ============================================================
// §8  ASK ENGINE  (Tiered ReAct)
// ============================================================

class AskEngine {
    constructor({ mikrotik, database, ai }) {
        this.mikrotik = mikrotik;
        this.database = database;
        this.ai = ai;

        // Gemini function declarations — lowercase types required by the API
        this._declarations = [
            {
                name: 'manage_network',
                description: 'Execute a command on the MikroTik router.',
                parameters: {
                    type: 'object',
                    properties: {
                        action: { type: 'string', enum: ['users.active', 'system.stats', 'user.kick', 'firewall.block', 'system.reboot'] },
                        target: { type: 'string' },
                    },
                    required: ['action'],
                },
            },
            {
                name: 'manage_vouchers',
                description: 'Create or query WiFi access vouchers.',
                parameters: {
                    type: 'object',
                    properties: {
                        action: { type: 'string', enum: ['create', 'stats', 'list'] },
                        plan: { type: 'string', enum: ['1hour', '1Day', '7Day', '30Day'] },
                    },
                    required: ['action'],
                },
            },
        ];

        // Tier-1 keyword → tool map
        this._toolMap = {
            'active users': { name: 'users.active', args: [] },
            'all users': { name: 'users.all', args: [] },
            'system stats': { name: 'system.stats', args: [] },
            'router status': { name: 'system.stats', args: [] },
            'reboot router': { name: 'system.reboot', args: [] },
            'dhcp leases': { name: 'dhcp.leases', args: [] },
            'arp table': { name: 'arp.table', args: [] },
        };
    }

    async run(input) {
        // Tier 1 — direct keyword → tool
        const tier1 = this._matchTool(input);
        if (tier1) {
            try {
                return { tier: 1, type: 'tool', result: await this.mikrotik.executeTool(tier1.name, ...tier1.args) };
            } catch (e) {
                return { tier: 1, type: 'error', result: e.message };
            }
        }

        // Tier 2 — rule-based shortcuts
        const rule = this._matchRule(input);
        if (rule) {
            try {
                return { tier: 2, type: 'rule', result: await rule() };
            } catch (e) {
                return { tier: 2, type: 'error', result: e.message };
            }
        }

        // Tier 3 — Gemini AI with function calling
        if (this.ai) {
            try {
                return await this._runAI(input);
            } catch (e) {
                return { tier: 3, type: 'error', result: e.message };
            }
        }

        // Tier 4 — fallback
        return { tier: 4, type: 'fallback', result: 'Command not understood and AI is unavailable.' };
    }

    async _runAI(input) {
        const model = this.ai.getGenerativeModel({
            model: 'gemini-2.5-flash',
            tools: [{ functionDeclarations: this._declarations }],
        });

        const chat = model.startChat();
        const result = await chat.sendMessage(input);
        const calls = result.response.functionCalls();
        const call = Array.isArray(calls) ? calls[0] : calls;

        if (call) {
            logger.debug(`AI function call: ${call.name}(${JSON.stringify(call.args)})`);
            const toolResult = await this._dispatchFunctionCall(call);

            const final = await chat.sendMessage([{
                functionResponse: { name: call.name, response: { content: toolResult } },
            }]);

            return { tier: 3, type: 'ai_act', result: final.response.text(), data: toolResult };
        }

        return { tier: 3, type: 'ai_chat', result: result.response.text() };
    }

    async _dispatchFunctionCall({ name, args }) {
        const { action, plan, target } = args || {};

        if (name === 'manage_vouchers') {
            if (action === 'create') return this.database.createVoucher(voucherCode(), { plan });
            if (action === 'stats') return this.database.getStats();
            if (action === 'list') return this.database.listVouchers({ limit: 5 });
        }

        if (name === 'manage_network') {
            return this.mikrotik.executeTool(action, target);
        }

        return { error: 'Unknown function' };
    }

    formatResponse(text) {
        // Safely coerce — tier-1/2 responses can be objects, not strings
        const s = (text !== null && text !== undefined && typeof text === 'object')
            ? JSON.stringify(text, null, 2)
            : String(text ?? '');
        const strOpts = String(s);
        const isTech = ['/ip', '/system', '/tool', 'delay', 'set '].some(k => strOpts.toLowerCase().includes(k));
        return (isTech && !strOpts.includes('```'))
            ? `🖥️ **Configuration:**\n\`\`\`routeros\n${strOpts.trim()}\n\`\`\``
            : s;
    }

    _matchTool(input) {
        const lower = input.toLowerCase();
        const key = Object.keys(this._toolMap).find(k => lower.includes(k));
        return key ? this._toolMap[key] : null;
    }

    _matchRule(input) {
        const lower = input.toLowerCase();
        if (lower.includes('voucher stats') || lower.includes('db stats')) {
            return () => this.database.getStats();
        }
        return null;
    }
}
const askEngine = new AskEngine({ mikrotik, database, ai: genAI });

// ============================================================
// §9  SYSTEM MONITOR
// ============================================================

class SystemMonitor {
    constructor(mikrotik, bot) {
        this.mikrotik = mikrotik;
        this.bot = bot;
        this._interval = null;
        this.thresholds = { cpu: 85, freeMemMB: 15 };
    }

    start(intervalMs = 60_000) {
        logger.info(`System monitor started (${intervalMs / 1000}s interval)`);
        this._interval = setInterval(() => this._check(), intervalMs);
    }

    async _check() {
        try {
            if (!this.mikrotik.isConnected) {
                this.bot?.alertOnce('conn_down', '🚨 *CRITICAL:* MikroTik Disconnected!');
                return;
            }
            const stats = await this.mikrotik.getSystemStats();
            const cpu = parseInt(stats['cpu-load']) || 0;
            const freeMem = parseInt(stats['free-memory']) / 1024 / 1024;

            if (cpu > this.thresholds.cpu)
                this.bot?.alertOnce('cpu_high', `🔥 *High Load:* Router CPU at ${cpu}%`);
            if (freeMem < this.thresholds.freeMemMB)
                this.bot?.alertOnce('mem_low', `⚠️ *Low Memory:* ${freeMem.toFixed(1)} MB remaining`);
        } catch (err) {
            logger.error(`System monitor check failed: ${err.message}`);
        }
    }
}

// ============================================================
// §10  CLI COMMANDS REGISTRY
// Declared here — before AgentOSGateway which references it.
// ============================================================

const cliCommandRegistry = {
    async voucher(args) {
        const [plan, duration] = args;
        if (!plan) return console.log('Usage: voucher <plan> [duration]');
        const code = voucherCode();
        await database.createVoucher(code, { plan, duration, createdBy: 'cli-batch' });
        console.log(code);
        if (mikrotik.isConnected) await mikrotik.addHotspotUser(code, code, plan).catch(() => { });
    },
    async redeem(args) {
        const [code, username] = args;
        if (!code || !username) return console.log('Usage: redeem <code> <username>');
        const voucher = await database.getVoucher(code);
        if (!voucher || voucher.used) return console.error('Invalid or already-used voucher');
        await mikrotik.connect();
        await mikrotik.addHotspotUser(username, username, voucher.plan);
        await database.redeemVoucher(code, { username });
        console.log(`Activated ${code} for ${username}`);
    },
    async status() {
        // Only connect if not already connected (avoid double-connect errors)
        if (!mikrotik.isConnected) await mikrotik.connect();
        const stats = await mikrotik.getSystemStats();
        console.log(JSON.stringify(stats, null, 2));
    },
    async 'batch-vouchers'(args) {
        const [count, plan] = args;
        for (let i = 0; i < (parseInt(count) || 1); i++) {
            const code = voucherCode();
            await database.createVoucher(code, { plan: plan || 'default', createdBy: 'cli-batch' });
            console.log(code);
        }
    },
};

// ============================================================
// §11  WEBSOCKET CLI SESSION
// ============================================================

class WebSocketCLI {
    constructor(clientId, ws, gateway) {
        this.clientId = clientId;
        this.ws = ws;
        this.gateway = gateway;
        this.buffer = '';
        this.cursorPos = 0;
        this.history = [];
        this.historyIndex = -1;
        this.cols = 80;
        this.rows = 24;
        this.isProcessing = false;
        this.pendingConfirm = null;  // Stores an async fn awaiting yes/no confirmation

        this._commands = this._buildCommands();
    }

    _buildCommands() {
        const b = (fn) => fn.bind(this);
        return {
            help: { fn: b(this.cmdHelp), desc: 'Show help' },
            connect: { fn: b(this.cmdConnect), desc: 'Connect to router' },
            disconnect: { fn: b(this.cmdDisconnect), desc: 'Disconnect' },
            status: { fn: b(this.cmdStatus), desc: 'Router stats' },
            cli: { fn: b(this.cmdRawCli), desc: 'Raw RouterOS CLI' },
            api: { fn: b(this.cmdRawApi), desc: 'Raw RouterOS API' },
            users: { fn: b(this.cmdUsers), desc: 'All hotspot users' },
            active: { fn: b(this.cmdActive), desc: 'Active users' },
            adduser: { fn: b(this.cmdAddUser), desc: 'Add user' },
            deluser: { fn: b(this.cmdDelUser), desc: 'Delete user' },
            kick: { fn: b(this.cmdKick), desc: 'Kick user' },
            voucher: { fn: b(this.cmdVoucher), desc: 'Create voucher' },
            vouchers: { fn: b(this.cmdVouchers), desc: 'List vouchers' },
            redeem: { fn: b(this.cmdRedeem), desc: 'Redeem voucher' },
            revoke: { fn: b(this.cmdRevoke), desc: 'Revoke voucher' },
            ping: { fn: b(this.cmdPing), desc: 'Ping host' },
            logs: { fn: b(this.cmdLogs), desc: 'Router logs' },
            dhcp: { fn: b(this.cmdDhcp), desc: 'DHCP leases' },
            arp: { fn: b(this.cmdArp), desc: 'ARP table' },
            firewall: { fn: b(this.cmdFirewall), desc: 'Firewall rules' },
            block: { fn: b(this.cmdBlock), desc: 'Block IP/MAC' },
            unblock: { fn: b(this.cmdUnblock), desc: 'Unblock IP/MAC' },
            reboot: { fn: b(this.cmdReboot), desc: 'Reboot router' },
            agent: { fn: b(this.cmdAgent), desc: 'AI coordinator' },
            nodes: { fn: b(this.cmdNodes), desc: 'Show nodes' },
            clear: { fn: b(this.cmdClear), desc: 'Clear screen' },
        };
    }

    // ── Input handling ───────────────────────────────────────

    sendPrompt() {
        this._out({ type: 'prompt', prompt: 'AgentOS> ', buffer: this.buffer, cursorPos: this.cursorPos });
    }

    handleInput(input) {
        // Intercept enter when a yes/no confirmation is pending (e.g. reboot)
        if (this.pendingConfirm && (input === '\r' || input === '\n')) {
            const answer = this.buffer.trim().toLowerCase();
            const action = this.pendingConfirm;
            this.pendingConfirm = null;
            this.buffer = '';
            this.cursorPos = 0;
            this._out({ type: 'executing', command: answer });
            if (answer === 'yes' || answer === 'y') {
                action().catch(err => {
                    this._out({ type: 'error', message: err.message });
                    this.sendPrompt();
                });
            } else {
                this._out({ type: 'warning', message: 'Action cancelled.' });
                this.sendPrompt();
            }
            return;
        }

        if (input === '\r' || input === '\n') {
            this._executeCommand();
        } else if (input === '\u0003') {            // Ctrl+C
            this.buffer = ''; this.cursorPos = 0;
            this._out({ type: 'clear_line' });
            this.sendPrompt();
        } else if (input === '\u007F') {            // Backspace
            if (this.cursorPos > 0) {
                this.buffer = this.buffer.slice(0, this.cursorPos - 1) + this.buffer.slice(this.cursorPos);
                this.cursorPos--;
                this._updateLine();
            }
        } else if (input === '\u001b[A') {          // Arrow up (history)
            if (this.historyIndex < this.history.length - 1) {
                this.historyIndex++;
                this.buffer = this.history[this.history.length - 1 - this.historyIndex] || '';
                this.cursorPos = this.buffer.length;
                this._updateLine();
            }
        } else if (input === '\u001b[B') {          // Arrow down (history)
            if (this.historyIndex > 0) {
                this.historyIndex--;
                this.buffer = this.history[this.history.length - 1 - this.historyIndex] || '';
                this.cursorPos = this.buffer.length;
            } else {
                this.historyIndex = -1;
                this.buffer = '';
                this.cursorPos = 0;
            }
            this._updateLine();
        } else if (input === '\u001b[C') {          // Arrow right
            if (this.cursorPos < this.buffer.length) { this.cursorPos++; this._out({ type: 'cursor', pos: this.cursorPos }); }
        } else if (input === '\u001b[D') {          // Arrow left
            if (this.cursorPos > 0) { this.cursorPos--; this._out({ type: 'cursor', pos: this.cursorPos }); }
        } else if (input === '\u001b[H') {          // Home
            this.cursorPos = 0; this._out({ type: 'cursor', pos: 0 });
        } else if (input === '\u001b[F') {          // End
            this.cursorPos = this.buffer.length; this._out({ type: 'cursor', pos: this.cursorPos });
        } else if (input.startsWith('\u001b')) {    // Other escape sequences — ignore
            // no-op
        } else if (input.length === 1 && input.charCodeAt(0) >= 32) {
            this.buffer = this.buffer.slice(0, this.cursorPos) + input + this.buffer.slice(this.cursorPos);
            this.cursorPos++;
            this._updateLine();
        }
    }

    _updateLine() {
        this._out({ type: 'update_line', prompt: 'AgentOS> ', buffer: this.buffer, cursorPos: this.cursorPos });
    }

    async _executeCommand() {
        const text = this.buffer.trim();
        if (!text) { this.sendPrompt(); return; }

        this.history.push(text);
        if (this.history.length > 100) this.history.shift();
        this.historyIndex = -1;
        this.buffer = '';
        this.cursorPos = 0;

        this._out({ type: 'executing', command: text });

        const [cmd, ...args] = text.split(/\s+/);
        const key = cmd.toLowerCase();

        if (key === 'exit' || key === 'quit') {
            this._out({ type: 'exit', message: 'Goodbye!' });
            this.gateway._handleCliStop(this.clientId);
            return;
        }

        this.isProcessing = true;
        try {
            if (this._commands[key]) {
                await this._commands[key].fn(args);
            } else {
                this._out({ type: 'thinking', message: 'Consulting AI…' });
                const resp = await askEngine.run(text);
                if (resp.type === 'ai_act') {
                    this._out({ type: 'result', tier: resp.tier, action: resp.result, data: resp.data });
                } else {
                    this._out({ type: 'result', tier: resp.tier, text: resp.result });
                }
            }
        } catch (err) {
            this._out({ type: 'error', message: err.message });
        }
        this.isProcessing = false;
        this.sendPrompt();
    }

    _out(data) {
        if (this.ws.readyState === WebSocket.OPEN)
            this.ws.send(JSON.stringify({ type: 'cli.output', ...data }));
    }

    // ── Commands ─────────────────────────────────────────────

    async cmdHelp() {
        const lines = Object.entries(this._commands)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([n, { desc }]) => `  ${n.padEnd(12)} ${desc}`)
            .join('\n');
        this._out({ type: 'text', text: `\n📋 Commands:\n${lines}\n\nType 'exit' to quit.\n` });
    }

    async cmdConnect() {
        try {
            await mikrotik.connect();
            this._out({ type: 'success', message: `Connected to ${CONFIG.MIKROTIK.IP}` });
        } catch (err) {
            this._out({ type: 'error', message: `Connection failed: ${err.message}` });
        }
    }

    async cmdDisconnect() {
        mikrotik.disconnect();
        this._out({ type: 'success', message: 'Disconnected' });
    }

    async cmdStatus() {
        try {
            const s = await mikrotik.getSystemStats();
            this._out({
                type: 'table', title: `Router Status (${CONFIG.MIKROTIK.IP})`, data: {
                    'CPU Load': `${s['cpu-load']}%`,
                    'Free Memory': fmtBytes(parseInt(s['free-memory']) || 0),
                    'Uptime': s.uptime,
                    'Version': s.version,
                }
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdRawCli(args) {
        const cmd = args.join(' ');
        if (!cmd) { this._out({ type: 'error', message: 'Usage: cli <command>' }); return; }
        try {
            const res = await mikrotik.executeCLI(cmd);
            this._out({ type: 'code', language: 'text', content: res });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdRawApi(args) {
        const cmd = args.join(' ');
        if (!cmd) { this._out({ type: 'error', message: 'Usage: api </path/command>' }); return; }
        try {
            const res = await mikrotik.executeRawAPI(cmd);
            this._out({ type: 'code', language: 'json', content: JSON.stringify(res, null, 2) });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdUsers() {
        try {
            const users = await mikrotik.getAllHotspotUsers();
            this._out({
                type: 'list', title: `Hotspot Users (${users.length})`,
                items: users.slice(0, 20).map(u => `${u.disabled === 'yes' ? '🔴' : '🟢'} ${u.name.padEnd(15)} ${u.profile || 'default'}`)
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdActive() {
        try {
            const users = await mikrotik.getActiveUsers();
            this._out({
                type: 'list', title: `Active Users (${users.length})`,
                items: users.map(u => `🟢 ${u.user.padEnd(15)} ${u.address.padEnd(15)} uptime: ${u.uptime}`)
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdAddUser([username, password, profile = 'default']) {
        if (!username || !password) { this._out({ type: 'error', message: 'Usage: adduser <name> <pass> [profile]' }); return; }
        try {
            const res = await mikrotik.addHotspotUser(username, password, profile);
            this._out({ type: 'success', message: `User ${res.username} ${res.action}` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdDelUser([username]) {
        if (!username) { this._out({ type: 'error', message: 'Usage: deluser <name>' }); return; }
        try {
            await mikrotik.removeHotspotUser(username);
            this._out({ type: 'success', message: `User ${username} deleted` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdKick([username]) {
        if (!username) { this._out({ type: 'error', message: 'Usage: kick <name>' }); return; }
        try {
            const res = await mikrotik.kickUser(username);
            this._out({
                type: res.kicked ? 'success' : 'warning',
                message: res.kicked ? `User ${username} kicked` : `User ${username} not active`
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdVoucher([plan, duration]) {
        if (!plan) { this._out({ type: 'error', message: 'Usage: voucher <plan> [duration]' }); return; }
        try {
            const code = voucherCode();
            await database.createVoucher(code, { plan, duration, createdBy: 'ws-cli' });
            if (mikrotik.isConnected) await mikrotik.addHotspotUser(code, code, plan).catch(() => { });
            this._out({ type: 'success', message: `🎫 Code: ${code}  Plan: ${plan}${mikrotik.isConnected ? '\n✅ Auto-provisioned' : ''}` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdVouchers([limit = '20']) {
        try {
            const list = await database.listVouchers({ limit: parseInt(limit) });
            this._out({
                type: 'list', title: `Recent Vouchers (${list.length})`,
                items: list.map(v => {
                    const tag = v.used ? '✅ USED' : (v.expiresAt && new Date(v.expiresAt) < new Date() ? '⌛ EXPIRED' : '⏳ ACTIVE');
                    return `${tag.padEnd(10)} ${v.id.padEnd(15)} ${v.plan}`;
                })
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdRedeem([code, username]) {
        if (!code || !username) { this._out({ type: 'error', message: 'Usage: redeem <code> <username>' }); return; }
        try {
            const v = await database.getVoucher(code);
            if (!v) return this._out({ type: 'error', message: 'Voucher not found' });
            if (v.used) return this._out({ type: 'error', message: 'Voucher already used' });
            await mikrotik.addHotspotUser(username, username, v.plan);
            await database.redeemVoucher(code, { username });
            this._out({ type: 'success', message: `Voucher ${code} redeemed for ${username}` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdRevoke([code]) {
        if (!code) { this._out({ type: 'error', message: 'Usage: revoke <code>' }); return; }
        try {
            await database.deleteVoucher(code);
            this._out({ type: 'success', message: `Voucher ${code} revoked` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdPing([host, count = '4']) {
        if (!host) { this._out({ type: 'error', message: 'Usage: ping <host> [count]' }); return; }
        try {
            this._out({ type: 'info', message: `Pinging ${host}…` });
            const res = await mikrotik.ping(host, parseInt(count));
            const recv = res.filter(r => r.received > 0).length;
            this._out({ type: 'result', text: `Sent: ${count}  Received: ${recv}  Lost: ${count - recv}` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdLogs([lines = '20']) {
        try {
            const logs = await mikrotik.getLogs(parseInt(lines));
            this._out({
                type: 'list', title: `Router Logs (${logs.length})`,
                items: logs.map(l => `${l.time || ''} [${(l.topics || '').padEnd(15)}] ${l.message || ''}`)
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdDhcp() {
        try {
            const leases = await mikrotik.getDhcpLeases();
            this._out({
                type: 'table', title: `DHCP Leases (${leases.length})`,
                data: leases.slice(0, 20).reduce((acc, l) => { acc[l.address] = `${l.hostname || 'N/A'} (${l.status || 'bound'})`; return acc; }, {})
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdArp() {
        try {
            const arp = await mikrotik.getArpTable();
            this._out({
                type: 'table', title: `ARP Table (${arp.length})`,
                data: arp.filter(e => e.address).slice(0, 20).reduce((acc, e) => { acc[e.address] = e['mac-address'] || 'N/A'; return acc; }, {})
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdFirewall() {
        try {
            const rules = await mikrotik.getFirewallRules('filter');
            this._out({
                type: 'list', title: `Firewall Filter (${rules.length})`,
                items: rules.slice(0, 10).map(r => `${r.chain}: ${r.action}${r.comment ? ` # ${r.comment}` : ''}`)
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdBlock([target]) {
        if (!target) { this._out({ type: 'error', message: 'Usage: block <ip-or-mac>' }); return; }
        try {
            await mikrotik.addToBlockList(target);
            this._out({ type: 'success', message: `Blocked: ${target}` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdUnblock([target]) {
        if (!target) { this._out({ type: 'error', message: 'Usage: unblock <ip-or-mac>' }); return; }
        try {
            const res = await mikrotik.unblockAddress(target);
            this._out({ type: 'success', message: `Unblocked: ${target} (${res.count} entries removed)` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdReboot() {
        this._out({ type: 'confirm', id: 'reboot', message: 'Type yes to confirm router reboot.' });
        this.pendingConfirm = async () => {
            try {
                await mikrotik.reboot();
                this._out({ type: 'success', message: 'Router is rebooting…' });
            } catch (err) {
                this._out({ type: 'error', message: `Reboot failed: ${err.message}` });
            }
            this.sendPrompt();
        };
    }

    async cmdAgent(args) {
        const query = args.join(' ');
        if (!query) { this._out({ type: 'error', message: 'Usage: agent <query>' }); return; }
        this._out({ type: 'thinking', message: 'Analysing…' });
        try {
            const resp = await askEngine.run(query);
            this._out({ type: 'ai_response', tier: resp.tier, responseType: resp.type, result: resp.result, data: resp.data });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdNodes() {
        this._out({
            type: 'text', text:
                `\n📡 Network Nodes\n${'━'.repeat(34)}\n` +
                `◆ Main-Router\n` +
                `  Status: ${mikrotik.isConnected ? '🟢 CONNECTED' : '🔴 OFFLINE'}\n` +
                `  Target: ${CONFIG.MIKROTIK.IP}\n`
        });
    }

    async cmdClear() { this._out({ type: 'clear' }); }

    resize(cols, rows) { this.cols = cols; this.rows = rows; }
    destroy() { this.buffer = ''; this.isProcessing = false; this.pendingConfirm = null; }
}

// ============================================================
// §12  WEBSOCKET GATEWAY  (CVE-2026-1526 patched)
// ============================================================

class AgentOSGateway {
    constructor(server) {
        this.wss = new WebSocket.Server({
            server,
            path: CONFIG.GATEWAY.WS_PATH,
            verifyClient: this._verify.bind(this),
            perMessageDeflate: false,    // CVE-2026-1526: disables memory-exhaustion vector
            maxPayload: 1024 * 1024,
            clientTracking: true,
        });
        this.clients = new Map();   // id → { ws, cliInstance, heartbeat, heartbeatInterval }
        this.cliSessions = new Map();   // id → WebSocketCLI
        this._setupHandlers();
    }

    _verify(info, cb) {
        const url = new URL(info.req.url, `http://${info.req.headers.host}`);
        const token = url.searchParams.get('token') || info.req.headers['x-agentos-token'];
        token === CONFIG.GATEWAY.TOKEN ? cb(true) : cb(false, 401, 'Invalid token');
    }

    _setupHandlers() {
        this.wss.on('connection', (ws) => {
            const id = uid();

            const heartbeat = setInterval(() => {
                if (ws.readyState !== WebSocket.OPEN) { clearInterval(heartbeat); return; }
                const c = this.clients.get(id);
                if (!c) { clearInterval(heartbeat); return; }
                if (Date.now() - c.heartbeat > 60_000) {
                    ws.terminate();
                    this._onDisconnect(id);
                    return;
                }
                this._send(ws, { type: 'ping', timestamp: Date.now() });
            }, 30_000);

            this.clients.set(id, {
                ws,
                cliInstance: null,
                heartbeat: Date.now(),
                heartbeatInterval: heartbeat,
            });

            this._send(ws, {
                type: 'hello',
                payload: {
                    service: BRAND.name,
                    version: BRAND.version,
                    timestamp: new Date().toISOString(),
                    endpoints: ['tool.invoke', 'cli.exec', 'cli.start', 'cli.input', 'cli.stop', 'cli.resize', 'status', 'ping'],
                },
            });

            ws.on('message', (data) => this._onMessage(id, data));
            ws.on('close', () => this._onDisconnect(id));
            ws.on('error', (err) => { logger.error(`WS error (${id}): ${err.message}`); this._onDisconnect(id); });
        });
    }

    _onDisconnect(id) {
        const c = this.clients.get(id);
        if (!c) return;
        if (c.heartbeatInterval) clearInterval(c.heartbeatInterval);
        if (c.cliInstance) { c.cliInstance.destroy(); this.cliSessions.delete(id); }
        this.clients.delete(id);
    }

    _onMessage(id, raw) {
        metrics.wsMessages++;
        let msg;
        try { msg = JSON.parse(raw); }
        catch { return this._sendToClient(id, { type: 'error', error: 'Invalid JSON' }); }

        const c = this.clients.get(id);
        if (!c) return;
        c.heartbeat = Date.now();

        switch (msg.type) {
            case 'pong': break;
            case 'tool.invoke': this._invokeTool(c.ws, msg); break;
            case 'call':
                if (TOOLS[msg.tool]) {
                    mikrotik.executeTool(msg.tool, ...(msg.params || []))
                        .then(data => this._send(c.ws, { type: 'result', id: msg.id, data }))
                        .catch(e => this._send(c.ws, { type: 'error', id: msg.id, message: e.message }));
                }
                break;
            case 'discover':
                this._send(c.ws, { type: 'tools', list: mikrotik.availableTools() });
                break;
            case 'status':
                this._send(c.ws, {
                    type: 'status', payload: {
                        mikrotik: mikrotik.isConnected ? 'connected' : 'disconnected',
                        clients: this.clients.size,
                        cliSessions: this.cliSessions.size,
                    }
                });
                break;
            case 'cli.exec': this._handleCliExec(id, msg); break;
            case 'cli.start': this._handleCliStart(id); break;
            case 'cli.input': this._handleCliInput(id, msg); break;
            case 'cli.stop': this._handleCliStop(id); break;
            case 'cli.resize': this._handleCliResize(id, msg); break;
            default:
                this._send(c.ws, { type: 'error', error: 'Unknown message type', received: msg.type });
        }
    }

    async _handleCliExec(clientId, msg) {
        const c = this.clients.get(clientId);
        if (!c) return;
        const { command, id } = msg;
        if (!command) return this._send(c.ws, { type: 'cli.error', id, error: 'No command provided' });

        try {
            const [cmd, ...args] = command.trim().split(/\s+/);
            const key = cmd.toLowerCase();
            let result;

            if (cliCommandRegistry[key]) {
                const outputs = [];
                const origLog = console.log, origErr = console.error;
                console.log = (...a) => outputs.push({ type: 'log', data: a.join(' ') });
                console.error = (...a) => outputs.push({ type: 'error', data: a.join(' ') });
                try {
                    await cliCommandRegistry[key](args);
                    result = { success: true, output: outputs };
                } catch (err) {
                    result = { success: false, error: err.message, output: outputs };
                } finally {
                    console.log = origLog; console.error = origErr;
                }
            } else {
                const output = await mikrotik.executeCLI(command);
                result = { success: true, output: [{ type: 'log', data: output }] };
            }

            this._send(c.ws, { type: 'cli.result', id, ...result });
        } catch (err) {
            this._send(c.ws, { type: 'cli.error', id, error: err.message });
        }
    }

    _handleCliStart(clientId) {
        const c = this.clients.get(clientId);
        if (!c) return;
        if (c.cliInstance) c.cliInstance.destroy();

        const session = new WebSocketCLI(clientId, c.ws, this);
        c.cliInstance = session;
        this.cliSessions.set(clientId, session);

        session.sendPrompt();
        this._send(c.ws, { type: 'cli.started', message: 'Interactive CLI session started. Type "exit" to quit.' });
    }

    _handleCliInput(clientId, msg) {
        const session = this.cliSessions.get(clientId);
        if (!session) {
            const c = this.clients.get(clientId);
            if (c) this._send(c.ws, { type: 'cli.error', error: 'No active CLI session — send cli.start first.' });
            return;
        }
        session.handleInput(msg.input);
    }

    _handleCliStop(clientId) {
        const c = this.clients.get(clientId);
        if (!c || !c.cliInstance) return;
        c.cliInstance.destroy();
        c.cliInstance = null;
        this.cliSessions.delete(clientId);
        this._send(c.ws, { type: 'cli.stopped', message: 'CLI session ended' });
    }

    _handleCliResize(clientId, msg) {
        this.cliSessions.get(clientId)?.resize(msg.cols || 80, msg.rows || 24);
    }

    async _invokeTool(ws, msg) {
        try {
            const result = await mikrotik.executeTool(msg.tool.replace(/^mikrotik\./, ''), ...(msg.params || []));
            this._send(ws, { type: 'tool.result', id: msg.id, result, success: true });
        } catch (err) {
            this._send(ws, { type: 'tool.error', id: msg.id, error: err.message, success: false });
        }
    }

    _send(ws, data) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
    }

    _sendToClient(id, data) {
        const c = this.clients.get(id);
        if (c) this._send(c.ws, data);
    }

    broadcast(payload) {
        this.clients.forEach(({ ws }) => this._send(ws, { type: 'broadcast', payload }));
    }

    closeAll() {
        this.clients.forEach(c => {
            if (c.heartbeatInterval) clearInterval(c.heartbeatInterval);
            c.ws.terminate();
        });
        this.clients.clear();
    }
}

// ============================================================
// §13  CHAT RATE LIMITER
// ============================================================

class ChatRateLimiter {
    constructor() {
        this._buckets = new Map();
        this._cleanup = setInterval(() => this._purge(), 60_000);
    }

    allow(chatId) {
        const now = Date.now();
        const win = CONFIG.SECURITY.VOUCHER_WINDOW_MS;
        let b = this._buckets.get(chatId);

        if (!b || now - b.windowStart > win) b = { count: 0, windowStart: now };
        if (b.count >= CONFIG.SECURITY.VOUCHER_RATE_LIMIT) { this._buckets.set(chatId, b); return false; }
        b.count++;
        this._buckets.set(chatId, b);
        return true;
    }

    _purge() {
        const cutoff = Date.now() - CONFIG.SECURITY.VOUCHER_WINDOW_MS * 2;
        for (const [id, b] of this._buckets)
            if (b.windowStart < cutoff) this._buckets.delete(id);
    }

    destroy() { clearInterval(this._cleanup); }
}

// ============================================================
// §14  TELEGRAM BOT
// ============================================================

class AgentOSBot {
    constructor() {
        // All properties initialised first — Orchestrator and Monitor call
        // alertOnce/sendToAll on this instance regardless of token availability.
        this.bot = null;
        this.rateLimiter = new ChatRateLimiter();
        this._cooldown = new Map();
        this.pendingInputs = new Map();

        if (!CONFIG.TELEGRAM.TOKEN) {
            logger.warn('Telegram not configured — bot disabled');
            return;
        }

        this.bot = new TelegramBot(CONFIG.TELEGRAM.TOKEN, { polling: false });

        this.bot.on('polling_error', (err) => {
            const isConflict = err.code === 'ETELEGRAM' && err.response?.body?.description?.includes('Conflict');
            logger.error(isConflict
                ? 'Telegram polling conflict — another instance is running'
                : `Telegram polling error: ${err.message}`);
        });

        this._registerHandlers();
        this.bot.startPolling({ restart: false, drop_pending_updates: true });
        logger.info('Telegram bot started');
    }

    _registerHandlers() {
        const on = (re, fn) => this.bot.onText(re, fn.bind(this));
        on(/\/start/, this._cmdStart);
        on(/\/dashboard/, this._cmdDashboard);
        on(/\/tools/, this._cmdTools);
        on(/\/network/, this._cmdNetwork);
        on(/\/users/, this._cmdUsers);
        on(/\/voucher/, this._cmdVoucher);
        on(/\/status/, this._cmdStatus);
        on(/\/help/, this._cmdHelp);
        on(/\/logs/, this._cmdLogs);
        on(/\/gen\s+(\S+)/, this._cmdGen);
        on(/\/ping\s+(\S+)(?:\s+(\d+))?/, this._cmdPing);
        on(/\/traceroute\s+(\S+)/, this._cmdTraceroute);
        on(/\/kick\s+(\w+)/, this._cmdKick);
        on(/\/adduser\s+(\S+)\s+(\S+)(?:\s+(\S+))?/, this._cmdAddUser);
        on(/\/block\s+(\S+)(?:\s+(.+))?/, this._cmdBlock);
        on(/\/tool\s+(\S+)(?:\s+(.*))?/, this._cmdTool);
        on(/\/cli\s+(.+)/, this._cmdCli);
        on(/\/api\s+(.+)/, this._cmdApi);
        on(/\/ask\s+(.+)/, this._cmdAsk);

        this.bot.on('message', this._onMessage.bind(this));
        this.bot.on('callback_query', this._onCallback.bind(this));
    }

    // ── Auth & messaging helpers ──────────────────────────────

    _checkAuth(msg) {
        if (!this.bot) return false;
        if (!CONFIG.TELEGRAM.ALLOWED_CHATS.length) return true;
        if (CONFIG.TELEGRAM.ALLOWED_CHATS.includes(String(msg.chat.id))) return true;
        this.bot.sendMessage(msg.chat.id, '⛔ *Unauthorised*', { parse_mode: 'Markdown' });
        return false;
    }

    sendToAll(text, opts = {}) {
        if (!this.bot) return;
        CONFIG.TELEGRAM.ALLOWED_CHATS.forEach(chatId =>
            this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...opts }).catch(() => { })
        );
    }

    alertOnce(key, text, buttons = null) {
        const now = Date.now();
        const last = this._cooldown.get(key) || 0;
        if (now - last < CONFIG.SECURITY.ALERT_COOLDOWN_MS) return false;
        this._cooldown.set(key, now);
        if (this._cooldown.size > 1000) this._cooldown.clear();
        metrics.alertsFired++;
        this.sendToAll(text, buttons ? { reply_markup: { inline_keyboard: buttons } } : {});
        return true;
    }

    promptUser(chatId, text, action) {
        if (!this.bot) return;
        this.pendingInputs.set(chatId, { action });
        this.bot.sendMessage(chatId, text, {
            reply_markup: { force_reply: true, selective: true },
            parse_mode: 'Markdown',
        });
    }

    _reply(chatId, text, opts = {}) {
        return this.bot?.sendMessage(chatId, text, { parse_mode: 'Markdown', ...opts }).catch(e => logger.error(`Telegram send error: ${e.message}`));
    }

    // ── Message routing ───────────────────────────────────────

    async _onMessage(msg) {
        if (!msg.text || !this._checkAuth(msg)) return;
        if (msg.text.startsWith('/')) { this.pendingInputs.delete(msg.chat.id); return; }

        const pending = this.pendingInputs.get(msg.chat.id);
        if (pending) {
            this.pendingInputs.delete(msg.chat.id);
            await this._executePending(msg.chat.id, msg.text.trim(), pending.action);
            return;
        }

        try {
            await this.bot.sendChatAction(msg.chat.id, 'typing');
            const resp = await askEngine.run(msg.text);

            let out;
            if (['ai_chat', 'ai_act', 'fallback', 'error'].includes(resp.type)) {
                out = resp.result;
            } else {
                out = `⚙️ *Tier ${resp.tier} (${resp.type}):*\n\`\`\`json\n${truncate(JSON.stringify(resp.result, null, 2), 3900)}\n\`\`\``;
            }
            this._reply(msg.chat.id, out);
        } catch (e) {
            this._reply(msg.chat.id, `❌ Error: ${e.message}`);
        }
    }

    async _executePending(chatId, input, action) {
        try {
            await this.bot.sendChatAction(chatId, 'typing');
            switch (action) {
                case 'ping': {
                    const res = await mikrotik.ping(input);
                    this._reply(chatId, `📡 *Ping: ${input}*\n\`\`\`json\n${JSON.stringify(res, null, 2)}\n\`\`\``);
                    break;
                }
                case 'traceroute': {
                    const res = await mikrotik.traceroute(input);
                    this._reply(chatId, `🛤 *Trace: ${input}*\n\`\`\`json\n${JSON.stringify(res, null, 2)}\n\`\`\``);
                    break;
                }
                case 'block':
                    await mikrotik.addToBlockList(input, 'blocked');
                    this._reply(chatId, `🚫 *${input}* blocked.`);
                    break;
                case 'kick': {
                    const res = await mikrotik.kickUser(input);
                    this._reply(chatId, res.kicked ? `🚫 *${input}* kicked.` : `⚠️ *${input}* not active.`);
                    break;
                }
                case 'adduser': {
                    const [u, p, pr = 'default'] = input.split(' ');
                    await mikrotik.addHotspotUser(u, p, pr);
                    this._reply(chatId, `✅ User *${u}* created.`);
                    break;
                }
                case 'user_status': {
                    const res = await mikrotik.getUserStatus(input);
                    this._reply(chatId, res
                        ? `🟢 *Active: ${input}*\nIP: \`${res.address}\`\nUptime: ${res.uptime}`
                        : `🔴 *${input}* NOT active.`);
                    break;
                }
            }
        } catch (err) {
            this._reply(chatId, `❌ Failed: ${err.message}`);
        }
    }

    // ── Command handlers ──────────────────────────────────────

    async _cmdStart(msg) {
        if (!this._checkAuth(msg)) return;
        this._reply(msg.chat.id, `${BRAND.emoji} *${BRAND.name}*\nWelcome, ${msg.from.first_name}!`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📊 Dashboard', callback_data: 'action:dashboard' }, { text: '🛠 Tools', callback_data: 'action:tools' }],
                    [{ text: '🌐 Network', callback_data: 'action:network' }, { text: '👥 Users', callback_data: 'action:users' }],
                    [{ text: '🎫 Voucher', callback_data: 'action:voucher' }, { text: '📈 Status', callback_data: 'action:status' }],
                ]
            },
        });
    }

    async _cmdDashboard(msg) {
        if (!this._checkAuth(msg)) return;
        try {
            const [dbRes, rtRes] = await Promise.allSettled([database.getStats(), mikrotik.getSystemStats()]);
            const db = dbRes.status === 'fulfilled' ? dbRes.value : {};
            const rt = rtRes.status === 'fulfilled' ? rtRes.value : null;
            const cpu = rt ? parseInt(rt['cpu-load']) : 0;
            const cpuIcon = cpu > 80 ? '🔴' : cpu > 50 ? '🟡' : '🟢';

            this._reply(msg.chat.id,
                `📊 *Dashboard*\n\n*Router*\nCPU: ${cpuIcon} ${cpu}%\nRAM Free: ${fmtBytes(parseInt(rt?.['free-memory']) || 0)}\n\n` +
                `*Vouchers*\nTotal: ${db.total || 0}  Active: ${db.active || 0}  Used: ${db.used || 0}`,
                {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🔄 Refresh', callback_data: 'action:dashboard' },
                            { text: '📋 Status', callback_data: 'action:status' },
                        ]]
                    }
                },
            );
        } catch (e) {
            logger.error(`_cmdDashboard: ${e.message}`);
            this._reply(msg.chat.id, `❌ Dashboard error: ${e.message}`);
        }
    }

    async _cmdTools(msg) {
        if (!this._checkAuth(msg)) return;
        const btns = mikrotik.availableTools().map(t => ({ text: `🔧 ${t}`, callback_data: `tool:${t}` }));
        const rows = [];
        for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
        this._reply(msg.chat.id, '*Available Tools*', { reply_markup: { inline_keyboard: rows } });
    }

    async _cmdNetwork(msg) {
        if (!this._checkAuth(msg)) return;
        this._reply(msg.chat.id, '🌐 *Network* — Select action:', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📡 Ping', callback_data: 'net:ping' }, { text: '🛤 Trace', callback_data: 'net:traceroute' }],
                    [{ text: '🔥 Firewall', callback_data: 'net:firewall' }, { text: '🚫 Block', callback_data: 'net:block' }],
                    [{ text: '📋 DHCP', callback_data: 'net:dhcp' }, { text: '🔍 LAN Scan', callback_data: 'net:scan' }],
                    [{ text: '📊 Interfaces', callback_data: 'net:bandwidth' }, { text: '🧹 Flush DNS', callback_data: 'net:flush_dns' }],
                    [{ text: '💾 Backup', callback_data: 'net:backup' }, { text: '⚡ Reboot', callback_data: 'net:reboot' }],
                ]
            },
        });
    }

    async _cmdUsers(msg) {
        if (!this._checkAuth(msg)) return;
        this._reply(msg.chat.id, '👥 *Users* — Select action:', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👁 Active', callback_data: 'users:active' }, { text: '📋 All', callback_data: 'users:all' }],
                    [{ text: '➕ Add', callback_data: 'users:add' }, { text: '🚫 Kick', callback_data: 'users:kick' }],
                    [{ text: '🔍 Status', callback_data: 'users:status' }],
                ]
            },
        });
    }

    async _cmdVoucher(msg) {
        if (!this._checkAuth(msg)) return;
        this._reply(msg.chat.id, '🎫 *Create Voucher* — Select duration:', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⏱ 1 Hour', callback_data: 'voucher:1h' }, { text: '📅 1 Day', callback_data: 'voucher:1d' }],
                    [{ text: '📆 7 Days', callback_data: 'voucher:7d' }, { text: '🌙 30 Days', callback_data: 'voucher:30d' }],
                ]
            },
        });
    }

    async _cmdStatus(msg) {
        if (!this._checkAuth(msg)) return;
        const snap = metrics.snapshot();
        this._reply(msg.chat.id,
            `*System Status*\n\nMikroTik: ${mikrotik.isConnected ? '🟢 Connected' : '🔴 Offline'}\n` +
            `Uptime: ${fmtUptime(snap.uptime)}\nDB: ${database.db ? 'Firebase' : 'Local'}\n` +
            `Tools Invoked: ${snap.toolInvocations}  Alerts: ${snap.alertsFired}`);
    }

    async _cmdHelp(msg) {
        if (!this._checkAuth(msg)) return;
        this._reply(msg.chat.id,
            `*Commands*\n/dashboard  /tools  /network  /users  /voucher  /status  /logs\n\n` +
            `*Advanced*\n/cli \\<command\\> — Raw RouterOS CLI\n/api \\<command\\> — Raw API\n/ask \\<query\\> — AI agent\n\n` +
            `Type any message for free-form AI chat.`);
    }

    async _cmdLogs(msg) {
        if (!this._checkAuth(msg)) return;
        try {
            const logs = await mikrotik.getLogs(10);
            const text = logs.map(l => `• ${l.time || ''} ${l.message || JSON.stringify(l)}`).join('\n');
            this._reply(msg.chat.id, `📋 *Router Logs*\n\n${text || 'No logs'}`);
        } catch (e) { this._reply(msg.chat.id, `❌ ${e.message}`); }
    }

    async _cmdAsk(msg, match) {
        if (!this._checkAuth(msg)) return;
        const chatId = msg.chat.id;
        const query = match[1];

        const status = await this.bot.sendMessage(chatId, '⏳ `[ AgentOS thinking… ]`', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🛑 Cancel', callback_data: 'action:cancel_ai' }]] },
        });

        const frames = ['⚡', '🧠', '🔍', '⚙️'];
        let step = 0;
        const anim = setInterval(() => {
            this.bot.editMessageText(
                `${frames[step++ % frames.length]} \`[ Processing: ${query.slice(0, 20)}… ]\``,
                { chat_id: chatId, message_id: status.message_id, parse_mode: 'Markdown' }
            ).catch(() => { });
        }, 1200);

        try {
            const resp = await askEngine.run(query);
            clearInterval(anim);
            const icon = resp.type === 'error' ? '❌' : '✅';
            const formatted = askEngine.formatResponse(resp.result);
            await this.bot.editMessageText(`${icon} *AgentOS Response:*\n\n${formatted}`, {
                chat_id: chatId, message_id: status.message_id, parse_mode: 'Markdown',
            });
        } catch (e) {
            clearInterval(anim);
            this.bot.editMessageText(`❌ *AI Error:* ${e.message}`,
                { chat_id: chatId, message_id: status.message_id, parse_mode: 'Markdown' }).catch(() => { });
        }
    }

    async _cmdGen(msg, match) {
        if (!this._checkAuth(msg)) return;
        try {
            if (!mikrotik.isConnected) throw new Error('Router disconnected');
            const plan = match[1];
            const code = voucherCode();
            await database.createVoucher(code, { plan, createdBy: 'telegram-cmd' });
            await mikrotik.addHotspotUser(code, code, plan);
            this._reply(msg.chat.id, `🎫 *Voucher Created*\nCode: \`${code}\`\nPlan: ${plan}`);
        } catch (e) { this._reply(msg.chat.id, `❌ ${e.message}`); }
    }

    async _cmdPing(msg, match) {
        if (!this._checkAuth(msg)) return;
        try {
            const res = await mikrotik.ping(match[1], parseInt(match[2]) || 4);
            this._reply(msg.chat.id, `📡 *Ping: ${match[1]}*\n\`\`\`json\n${JSON.stringify(res, null, 2)}\n\`\`\``);
        } catch (e) { this._reply(msg.chat.id, `❌ ${e.message}`); }
    }

    async _cmdTraceroute(msg, match) {
        if (!this._checkAuth(msg)) return;
        try {
            const res = await mikrotik.traceroute(match[1]);
            this._reply(msg.chat.id, `🛤 *Traceroute: ${match[1]}*\n\`\`\`json\n${JSON.stringify(res, null, 2)}\n\`\`\``);
        } catch (e) { this._reply(msg.chat.id, `❌ ${e.message}`); }
    }

    async _cmdKick(msg, match) {
        if (!this._checkAuth(msg)) return;
        try {
            const res = await mikrotik.kickUser(match[1]);
            this._reply(msg.chat.id, res.kicked ? `🚫 Kicked *${match[1]}*` : `⚠️ *${match[1]}* not active`);
        } catch (e) { this._reply(msg.chat.id, `❌ ${e.message}`); }
    }

    async _cmdAddUser(msg, match) {
        if (!this._checkAuth(msg)) return;
        try {
            const res = await mikrotik.addHotspotUser(match[1], match[2], match[3] || 'default');
            this._reply(msg.chat.id, `✅ User *${match[1]}* ${res.action}`);
        } catch (e) { this._reply(msg.chat.id, `❌ ${e.message}`); }
    }

    async _cmdBlock(msg, match) {
        if (!this._checkAuth(msg)) return;
        try {
            await mikrotik.addToBlockList(match[1]);
            this._reply(msg.chat.id, `🚫 Blocked *${match[1]}*`);
        } catch (e) { this._reply(msg.chat.id, `❌ ${e.message}`); }
    }

    async _cmdTool(msg, match) {
        if (!this._checkAuth(msg)) return;
        try {
            const params = match[2] ? match[2].trim().split(/\s+/) : [];
            const res = await mikrotik.executeTool(match[1], ...params);
            this._reply(msg.chat.id, `✅ *${match[1]}*\n\`\`\`json\n${truncate(JSON.stringify(res, null, 2))}\n\`\`\``);
        } catch (e) { this._reply(msg.chat.id, `❌ ${e.message}`); }
    }

    async _cmdCli(msg, match) {
        if (!this._checkAuth(msg)) return;
        try {
            await this.bot.sendChatAction(msg.chat.id, 'typing');
            const res = await mikrotik.executeCLI(match[1]);
            this._reply(msg.chat.id, `💻 *CLI:*\n\`\`\`text\n${truncate(res, 3900)}\n\`\`\``);
        } catch (e) { this._reply(msg.chat.id, `❌ CLI Error: ${e.message}`); }
    }

    async _cmdApi(msg, match) {
        if (!this._checkAuth(msg)) return;
        try {
            await this.bot.sendChatAction(msg.chat.id, 'typing');
            const res = await mikrotik.executeRawAPI(match[1]);
            this._reply(msg.chat.id, `⚙️ *API:*\n\`\`\`json\n${truncate(JSON.stringify(res, null, 2), 3900)}\n\`\`\``);
        } catch (e) { this._reply(msg.chat.id, `❌ API Error: ${e.message}`); }
    }

    // ── Callback query handler ────────────────────────────────

    async _onCallback(query) {
        const chatId = query.message.chat.id;
        const msgId = query.message.message_id;
        const [cat, act] = (query.data || '').split(':');

        try { await this.bot.answerCallbackQuery(query.id); } catch { /* stale query — ignore */ }

        // Security: authenticate every callback — not just 'action' dispatch
        const fakeMsg = { chat: { id: chatId }, from: query.from };
        if (!this._checkAuth(fakeMsg)) return;

        try {
            if (cat === 'action') {
                if (act === 'cancel_ai') {
                    await this.bot.editMessageText('🛑 *Cancelled.*',
                        { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }).catch(() => { });
                } else {
                    const map = {
                        dashboard: '_cmdDashboard', tools: '_cmdTools',
                        network: '_cmdNetwork', users: '_cmdUsers',
                        voucher: '_cmdVoucher', status: '_cmdStatus'
                    };
                    if (map[act]) this[map[act]](fakeMsg);
                }
            }

            else if (cat === 'tool') {
                const result = await mikrotik.executeTool(act);
                this._reply(chatId, `✅ *${act}*\n\`\`\`json\n${truncate(JSON.stringify(result, null, 2))}\n\`\`\``);
            }

            else if (cat === 'net') {
                switch (act) {
                    case 'ping': this.promptUser(chatId, '📡 Enter IP/host to ping:', 'ping'); break;
                    case 'traceroute': this.promptUser(chatId, '🛤 Enter IP/host to trace:', 'traceroute'); break;
                    case 'block': this.promptUser(chatId, '🚫 Enter IP/MAC to block:', 'block'); break;
                    case 'flush_dns': {
                        await mikrotik.executeTool('dns.flush');
                        this._reply(chatId, '✅ DNS cache flushed');
                        break;
                    }
                    case 'backup': {
                        const b = await mikrotik.executeTool('system.backup');
                        this._reply(chatId, `💾 Backup saved: ${b.file}`);
                        break;
                    }
                    case 'reboot':
                        this._reply(chatId, '⚠️ Confirm router reboot?', {
                            reply_markup: { inline_keyboard: [[{ text: '✅ Yes, reboot', callback_data: 'confirm:reboot' }]] }
                        });
                        break;
                    default: {
                        const map = {
                            dhcp: [() => mikrotik.getDhcpLeases(), 'DHCP Leases'],
                            scan: [() => mikrotik.getArpTable(), 'LAN Scan (ARP)'],
                            firewall: [() => mikrotik.getFirewallRules(), 'Firewall Rules'],
                            bandwidth: [() => mikrotik.getInterfaces(), 'Interfaces'],
                        };
                        if (map[act]) {
                            const [fn, title] = map[act];
                            const res = await fn();
                            this._reply(chatId, `*${title} (${res.length})*\n\`\`\`json\n${truncate(JSON.stringify(res.slice(0, 5), null, 2))}\n\`\`\``);
                        }
                    }
                }
            }

            else if (cat === 'users') {
                if (act === 'add') this.promptUser(chatId, '➕ Format: `username password`', 'adduser');
                else if (act === 'kick') this.promptUser(chatId, '🚫 Username to kick:', 'kick');
                else if (act === 'status') this.promptUser(chatId, '🔍 Username to check:', 'user_status');
                else if (act === 'active' || act === 'all') {
                    const list = act === 'active' ? await mikrotik.getActiveUsers() : await mikrotik.getAllHotspotUsers();
                    const text = list.slice(0, 15).map(u => `• ${u.user || u.name}${u.address ? ` (${u.address})` : ''}`).join('\n');
                    this._reply(chatId, `👥 *${act === 'active' ? 'Active' : 'All'} Users (${list.length})*\n\n${text || 'None'}`);
                }
            }

            else if (cat === 'voucher') {
                const planMap = { '1h': '1hour', '1d': '1Day', '7d': '7Day', '30d': '30Day' };
                const plan = planMap[act];
                if (plan) {
                    if (!this.rateLimiter.allow(chatId)) { this._reply(chatId, '⏳ Too many requests — slow down.'); return; }
                    if (!mikrotik.isConnected) throw new Error('Router disconnected');
                    const code = voucherCode();
                    await database.createVoucher(code, { plan, createdBy: 'telegram' });
                    await mikrotik.addHotspotUser(code, code, plan);
                    const url = `${ENV.SERVER_URL}/login.html?code=${code}`;
                    const qrBuf = await QRCode.toBuffer(JSON.stringify({ code, plan, url }));
                    await this.bot.sendPhoto(chatId, qrBuf, {
                        caption: `🎟 *Voucher*\nCode: \`${code}\`\nPlan: ${plan}`,
                        parse_mode: 'Markdown',
                    });
                }
            }

            else if (cat === 'confirm' && act === 'reboot') {
                await mikrotik.reboot();
                this._reply(chatId, '✅ Router rebooting…');
            }

        } catch (e) {
            this._reply(chatId, `❌ Error: ${e.message}`);
        }
    }
}

// ============================================================
// §15  ORCHESTRATOR
// ============================================================

class AgentOSOrchestrator {
    constructor(mikrotik, db, gateway, bot) {
        this.mikrotik = mikrotik;
        this.db = db;
        this.gateway = gateway;
        this.bot = bot;
        this._knownMacs = new Set();
        this._start();
    }

    _start() {
        this._monitorSystem();
        this._monitorNewDevices();
        this._scheduleVoucherExpiry();
    }

    _monitorSystem() {
        setInterval(async () => {
            if (!this.mikrotik.isConnected) return;
            try {
                const s = await this.mikrotik.getSystemStats();
                const cpu = parseInt(s?.['cpu-load']) || 0;
                const fm = parseInt(s?.['free-memory']) || 0;
                const tm = parseInt(s?.['total-memory']) || 1;
                if (cpu > 90)
                    this.bot?.alertOnce('cpu-high', `⚠️ *High CPU:* ${cpu}%`);
                if ((1 - fm / tm) > 0.85)
                    this.bot?.alertOnce('mem-high', `⚠️ *High Memory:* ${Math.round((1 - fm / tm) * 100)}% used`);
            } catch (err) {
                logger.error(`Orchestrator system monitor: ${err.message}`);
            }
        }, 15_000);
    }

    _monitorNewDevices() {
        let firstScan = true;
        setInterval(async () => {
            if (!this.mikrotik.isConnected) return;
            try {
                const arp = await this.mikrotik.getArpTable();
                for (const dev of arp.filter(e => e.address && e['mac-address'])) {
                    const mac = dev['mac-address'];
                    if (!this._knownMacs.has(mac)) {
                        this._knownMacs.add(mac);
                        if (!firstScan)
                            this.bot?.alertOnce(`new-device-${mac}`, `🆕 *New Device*\nIP: \`${dev.address}\`  MAC: \`${mac}\``);
                    }
                }
                firstScan = false;
            } catch { /* silence transient read failures */ }
        }, 60_000);
    }

    _scheduleVoucherExpiry() {
        setInterval(async () => {
            try {
                const count = await this.db.expireOldVouchers();
                if (count > 0) {
                    this.bot?.sendToAll(`⌛ ${count} voucher(s) expired.`);
                    this.gateway?.broadcast({ type: 'vouchers.expired', count });
                }
            } catch (err) {
                logger.error(`Voucher expiry task: ${err.message}`);
            }
        }, 60 * 60_000);
    }
}

// ============================================================
// §16  EXPRESS APPLICATION
// ============================================================

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: ENV.ALLOWED_ORIGINS === '*' ? '*' : ENV.ALLOWED_ORIGINS.split(',') }));
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit({
    windowMs: CONFIG.SECURITY.RATE_LIMIT_WINDOW,
    max: CONFIG.SECURITY.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests — please retry later.' },
}));
app.use((req, _res, next) => { metrics.requests++; next(); });
app.use(express.static('public'));
app.get('/', (_req, res) => res.redirect('/index.html'));

// ── Routes ───────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
    const stats = await database.getStats().catch(() => ({}));
    res.json({
        status: 'ok',
        version: BRAND.version,
        services: { mikrotik: mikrotik.isConnected, database: database.db ? 'firebase' : 'local' },
        stats,
        metrics: metrics.snapshot(),
    });
});

app.get('/api/stats', async (_req, res) => {
    try {
        const [dbRes, rtRes] = await Promise.allSettled([database.getStats(), mikrotik.getSystemStats()]);
        res.json({
            vouchers: dbRes.status === 'fulfilled' ? dbRes.value : {},
            router: rtRes.status === 'fulfilled' ? rtRes.value : null,
            metrics: metrics.snapshot(),
            mikrotik: mikrotik.isConnected,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/vouchers', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const used = req.query.used === 'true' ? true : req.query.used === 'false' ? false : undefined;
        const items = await database.listVouchers({ limit, used });
        res.json({ count: items.length, items });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const redeemSchema = Joi.object({
    code: Joi.string().pattern(/^STAR-[A-Z0-9]{6}$/).required(),
    user: Joi.string().alphanum().min(3).max(20).required(),
});

app.post('/voucher/redeem', async (req, res) => {
    try {
        const { error, value } = redeemSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const { code, user } = value;
        const voucher = await database.getVoucher(code);
        if (!voucher) return res.status(404).json({ error: 'Voucher not found' });
        if (voucher.used) return res.status(400).json({ error: 'Voucher already used' });
        if (voucher.expiresAt && new Date(voucher.expiresAt) < new Date())
            return res.status(400).json({ error: 'Voucher expired' });
        if (!mikrotik.isConnected) return res.status(503).json({ error: 'Router unavailable' });

        await mikrotik.addHotspotUser(user, user, voucher.plan);
        await database.redeemVoucher(code, { username: user, ip: req.ip });
        res.json({ status: 'activated', plan: voucher.plan });
    } catch (err) {
        metrics.errors++;
        res.status(500).json({ error: 'Failed to activate voucher' });
    }
});

app.get('/voucher/:code/qr', async (req, res) => {
    try {
        const voucher = await database.getVoucher(req.params.code);
        if (!voucher) return res.status(404).json({ error: 'Not found' });
        const url = `${req.protocol}://${req.get('host')}/login.html?code=${req.params.code}`;
        const qr = await QRCode.toDataURL(JSON.stringify({ code: req.params.code, plan: voucher.plan, url }));
        res.json({ qr, code: req.params.code, plan: voucher.plan });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/tool/execute', async (req, res) => {
    try {
        const { tool, params } = req.body;
        if (!tool || !mikrotik.availableTools().includes(tool))
            return res.status(400).json({ error: 'Invalid or unknown tool' });
        const result = await mikrotik.executeTool(tool, ...(params || []));
        res.json({ success: true, result });
    } catch (err) {
        metrics.errors++;
        res.status(500).json({ success: false, error: err.message });
    }
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
    metrics.errors++;
    logger.error(`Express unhandled: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// §17  INTERACTIVE CLI  (readline REPL)
// ============================================================

class CLI {
    constructor() {
        this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        process.on('SIGINT', () => { console.log('\nSIGINT — shutting down…'); this.rl.close(); mikrotik.disconnect(); process.exit(0); });
        this._commands = this._buildCommands();
    }

    _buildCommands() {
        const b = (fn) => fn.bind(this);
        return {
            help: { fn: b(this.cmdHelp), desc: 'Show help' },
            connect: { fn: b(this.cmdConnect), desc: 'Connect to router' },
            disconnect: { fn: b(this.cmdDisconnect), desc: 'Disconnect from router' },
            status: { fn: b(this.cmdStatus), desc: 'Router stats' },
            cli: { fn: b(this.cmdRawCli), desc: 'Raw RouterOS CLI' },
            api: { fn: b(this.cmdRawApi), desc: 'Raw RouterOS API' },
            agent: { fn: b(this.cmdAgent), desc: 'AI coordinator' },
            nodes: { fn: b(this.cmdNodes), desc: 'Show network nodes' },
            users: { fn: b(this.cmdUsers), desc: 'All hotspot users' },
            active: { fn: b(this.cmdActive), desc: 'Active users' },
            adduser: { fn: b(this.cmdAddUser), desc: 'Add hotspot user' },
            deluser: { fn: b(this.cmdDelUser), desc: 'Delete hotspot user' },
            kick: { fn: b(this.cmdKick), desc: 'Kick active user' },
            voucher: { fn: b(this.cmdVoucher), desc: 'Create voucher' },
            vouchers: { fn: b(this.cmdVouchers), desc: 'List vouchers' },
            redeem: { fn: b(this.cmdRedeem), desc: 'Redeem voucher' },
            revoke: { fn: b(this.cmdRevoke), desc: 'Revoke voucher' },
            ping: { fn: b(this.cmdPing), desc: 'Ping a host' },
            logs: { fn: b(this.cmdLogs), desc: 'Router logs' },
            dhcp: { fn: b(this.cmdDhcp), desc: 'DHCP leases' },
            arp: { fn: b(this.cmdArp), desc: 'ARP table' },
            firewall: { fn: b(this.cmdFirewall), desc: 'Firewall rules' },
            block: { fn: b(this.cmdBlock), desc: 'Block IP/MAC' },
            unblock: { fn: b(this.cmdUnblock), desc: 'Unblock IP/MAC' },
            reboot: { fn: b(this.cmdReboot), desc: 'Reboot router' },
            qr: { fn: b(this.cmdQR), desc: 'Print voucher QR code' },
            stats: { fn: b(this.cmdStats), desc: 'Voucher statistics' },
        };
    }

    async start() {
        console.clear();
        console.log(A.NEON_CYAN + `
╔══════════════════════════════════════════════════════════════════╗
║                   AGENTOS PLATFORM v${BRAND.version}                  ║
║              Modular AI Agent Operating System                   ║
╚══════════════════════════════════════════════════════════════════╝
` + A.RESET);
        console.log(`  ${A.INFO}Interactive REPL ready. Type 'help' or 'exit'.${A.RESET}\n`);
        await this.cmdConnect();
        this.rl.setPrompt(`${A.PRIMARY}${A.BOLD}AgentOS> ${A.RESET}`);
        this.rl.prompt();

        this.rl.on('line', async (line) => {
            const text = line.trim();
            if (!text) { this.rl.prompt(); return; }
            const [cmd, ...args] = text.split(/\s+/);
            const key = cmd.toLowerCase();

            if (key === 'exit' || key === 'quit') {
                console.log('  Shutting down AgentOS…');
                mikrotik.disconnect();
                process.exit(0);
            }
            if (key === 'clear') { console.clear(); this.rl.prompt(); return; }

            if (this._commands[key]) {
                try { await this._commands[key].fn(args); }
                catch (err) { console.error(`  ${A.ERROR}Error: ${err.message}${A.RESET}`); }
            } else {
                await TerminalAnimator.showSpinner('Consulting AI…', 600);
                try {
                    const resp = await askEngine.run(text);
                    console.log(`\n  ${A.NEON_CYAN}🤖 Agent (Tier ${resp.tier} — ${resp.type}):${A.RESET}`);
                    if (resp.type === 'ai_act') {
                        await TerminalAnimator.typewriter(resp.result, 15);
                        console.log(`  ${A.DIM}Data: ${JSON.stringify(resp.data, null, 2)}${A.RESET}`);
                    } else {
                        await TerminalAnimator.typewriter(String(resp.result), 15);
                    }
                } catch (e) {
                    console.log(`  ${A.ERROR}Error: ${e.message}${A.RESET}`);
                }
            }
            this.rl.prompt();
        }).on('close', () => { mikrotik.disconnect(); process.exit(0); });
    }

    // ── Commands ─────────────────────────────────────────────

    async cmdHelp() {
        console.log('\n📋 Commands:\n');
        Object.entries(this._commands)
            .sort(([a], [b]) => a.localeCompare(b))
            .forEach(([n, { desc }]) =>
                console.log(`  ${A.PRIMARY}${n.padEnd(12)}${A.RESET} ${A.DIM}${desc}${A.RESET}`));
        console.log('');
    }

    async cmdConnect() {
        try {
            await mikrotik.connect();
            console.log(`${A.SUCCESS}✔ Connected to ${CONFIG.MIKROTIK.IP}${A.RESET}`);
            return true;
        } catch {
            console.log(`${A.ERROR}✗ Connection failed — check .env credentials${A.RESET}`);
            return false;
        }
    }

    async cmdDisconnect() { mikrotik.disconnect(); console.log('🔌 Disconnected'); }

    async cmdStatus() {
        const s = await mikrotik.getSystemStats();
        console.log(`\n🔧 Router: ${CONFIG.MIKROTIK.IP}\n${'━'.repeat(32)}`);
        console.log(`CPU:     ${s['cpu-load']}%`);
        console.log(`RAM:     ${fmtBytes(parseInt(s['free-memory']) || 0)} free`);
        console.log(`Uptime:  ${s.uptime}\nVersion: ${s.version}\n`);
    }

    async cmdRawCli(args) {
        const cmd = args.join(' ');
        if (!cmd) { console.log('Usage: cli <command>'); return; }
        const res = await mikrotik.executeCLI(cmd);
        console.log(`\n💻 Output:\n${res}\n`);
    }

    async cmdRawApi(args) {
        const cmd = args.join(' ');
        if (!cmd) { console.log('Usage: api </path/command>'); return; }
        const res = await mikrotik.executeRawAPI(cmd);
        console.log(`\n⚙️ Result:\n${JSON.stringify(res, null, 2)}\n`);
    }

    async cmdAgent(args) {
        const query = args.join(' ');
        if (!query) { console.log(`Usage: agent <query>`); return; }
        TerminalAnimator.printHeader('AI COORDINATOR');
        await TerminalAnimator.showSpinner('Analysing…', 600);
        try {
            const resp = await askEngine.run(query);
            console.log(`  ${A.DIM}Tier ${resp.tier} (${resp.type})${A.RESET}`);
            if (resp.type === 'ai_act') {
                await TerminalAnimator.typewriter(resp.result, 15);
                console.log(`  ${A.DIM}Data: ${JSON.stringify(resp.data, null, 2)}${A.RESET}`);
            } else {
                console.log(`  ${resp.result}`);
            }
        } catch (e) {
            console.log(`  ${A.ERROR}Error: ${e.message}${A.RESET}`);
        }
    }

    async cmdNodes() {
        TerminalAnimator.printHeader('NETWORK NODES');
        await sleep(400);
        console.log(`  ${A.PRIMARY}◆${A.RESET} Main-Router`);
        console.log(`  ${A.DIM}│  Status: ${mikrotik.isConnected ? A.SUCCESS + 'CONNECTED' : A.ERROR + 'OFFLINE'}${A.RESET}`);
        console.log(`  ${A.DIM}│  Target: ${A.RESET}${CONFIG.MIKROTIK.IP}\n`);
    }

    async cmdUsers() {
        const users = await mikrotik.getAllHotspotUsers();
        console.log(`\n📋 Hotspot Users (${users.length}):\n`);
        users.slice(0, 20).forEach(u =>
            console.log(`  ${u.disabled === 'yes' ? '🔴' : '🟢'} ${u.name.padEnd(15)} ${u.profile || 'default'}`));
        console.log('');
    }

    async cmdActive() {
        const users = await mikrotik.getActiveUsers();
        console.log(`\n👥 Active (${users.length}):\n`);
        users.forEach(u => console.log(`  🟢 ${u.user.padEnd(15)} ${u.address.padEnd(15)} ${u.uptime}`));
        console.log('');
    }

    async cmdAddUser([username, password, profile = 'default']) {
        if (!username || !password) { console.log('Usage: adduser <name> <pass> [profile]'); return; }
        const res = await mikrotik.addHotspotUser(username, password, profile);
        console.log(`✅ User ${res.username} ${res.action}`);
    }

    async cmdDelUser([username]) {
        if (!username) { console.log('Usage: deluser <name>'); return; }
        await mikrotik.removeHotspotUser(username);
        console.log(`✅ User ${username} deleted`);
    }

    async cmdKick([username]) {
        if (!username) { console.log('Usage: kick <name>'); return; }
        const res = await mikrotik.kickUser(username);
        console.log(res.kicked ? `🚫 ${username} kicked` : `⚠️ ${username} not active`);
    }

    async cmdVoucher([plan, duration]) {
        if (!plan) { console.log('Usage: voucher <plan> [duration]'); return; }
        const code = voucherCode();
        await database.createVoucher(code, { plan, duration, createdBy: 'cli' });
        console.log(`\n🎫 Voucher Created\n${'━'.repeat(32)}\nCode:  ${code}\nPlan:  ${plan}\nTime:  ${new Date().toLocaleString()}\n`);
        if (mikrotik.isConnected) {
            await mikrotik.addHotspotUser(code, code, plan).catch(() => { });
            console.log('✅ Auto-provisioned on MikroTik');
        }
    }

    async cmdVouchers([limit = '20']) {
        const list = await database.listVouchers({ limit: parseInt(limit) });
        console.log(`\n🎫 Vouchers (${list.length}):\n`);
        list.forEach(v => {
            const tag = v.used ? '✅ USED' : (v.expiresAt && new Date(v.expiresAt) < new Date() ? '⌛ EXPIRED' : '⏳ ACTIVE');
            console.log(`  ${tag.padEnd(10)} ${v.id.padEnd(15)} ${v.plan}`);
        });
        console.log('');
    }

    async cmdRedeem([code, username]) {
        if (!code || !username) { console.log('Usage: redeem <code> <username>'); return; }
        const v = await database.getVoucher(code);
        if (!v) { console.log('Voucher not found'); return; }
        if (v.used) { console.log('Voucher already used'); return; }
        await mikrotik.addHotspotUser(username, username, v.plan);
        await database.redeemVoucher(code, { username });
        console.log(`✅ ${code} redeemed for ${username}`);
    }

    async cmdRevoke([code]) {
        if (!code) { console.log('Usage: revoke <code>'); return; }
        await database.deleteVoucher(code);
        console.log(`🗑  Voucher ${code} revoked`);
    }

    async cmdPing([host, count = '4']) {
        if (!host) { console.log('Usage: ping <host> [count]'); return; }
        console.log(`📡 Pinging ${host}…`);
        const n = parseInt(count) || 4;
        const results = await mikrotik.ping(host, n);
        const recv = results.filter(r => parseInt(r.received) > 0).length;
        console.log(`Sent: ${n}  Received: ${recv}  Lost: ${n - recv}`);
    }

    async cmdLogs([lines = '20']) {
        const logs = await mikrotik.getLogs(parseInt(lines));
        console.log(`\n📋 Logs (${logs.length}):\n`);
        logs.forEach(l => console.log(`  ${l.time || ''} [${(l.topics || '').padEnd(15)}] ${l.message || ''}`));
        console.log('');
    }

    async cmdDhcp() {
        const leases = await mikrotik.getDhcpLeases();
        console.log(`\n📋 DHCP (${leases.length}):\n`);
        leases.slice(0, 20).forEach(l =>
            console.log(`  ${l.address.padEnd(15)} ${(l.hostname || '').padEnd(20)} ${l.status || 'bound'}`));
        console.log('');
    }

    async cmdArp() {
        const arp = await mikrotik.getArpTable();
        console.log(`\n🔍 ARP (${arp.length}):\n`);
        arp.filter(e => e.address).slice(0, 20).forEach(e =>
            console.log(`  ${e.address.padEnd(15)} ${e['mac-address'] || 'N/A'}`));
        console.log('');
    }

    async cmdFirewall() {
        const rules = await mikrotik.getFirewallRules('filter');
        console.log(`\n🛡️  Firewall Filter (${rules.length}):\n`);
        rules.slice(0, 10).forEach(r =>
            console.log(`  ${r.chain}: ${r.action}${r.comment ? ` # ${r.comment}` : ''}`));
        console.log('');
    }

    async cmdBlock([target]) {
        if (!target) { console.log('Usage: block <ip-or-mac>'); return; }
        await mikrotik.addToBlockList(target);
        console.log(`🚫 Blocked: ${target}`);
    }

    async cmdUnblock([target]) {
        if (!target) { console.log('Usage: unblock <ip-or-mac>'); return; }
        const res = await mikrotik.unblockAddress(target);
        console.log(`✅ Unblocked: ${target} (${res.count} entries removed)`);
    }

    async cmdReboot() {
        this.rl.question('⚠️  Reboot router? (yes/no): ', async (answer) => {
            if (answer.toLowerCase() === 'yes') {
                await mikrotik.reboot();
                console.log('🔄 Rebooting…');
                mikrotik.disconnect();
            } else {
                console.log('❌ Cancelled');
            }
            this.rl.prompt();
        });
    }

    async cmdQR([code]) {
        if (!code) { console.log('Usage: qr <code>'); return; }
        const v = await database.getVoucher(code);
        if (!v) { console.log('Voucher not found'); return; }
        const url = `http://${CONFIG.MIKROTIK.IP}/login.html?code=${code}`;
        try {
            console.log(await QRCode.toString(JSON.stringify({ code, plan: v.plan, url }), { type: 'terminal', small: true }));
        } catch (e) {
            console.error(`QR generation failed: ${e.message}`);
        }
    }

    async cmdStats() {
        const s = await database.getStats();
        console.log(`\n📊 Vouchers — Total: ${s.total}  Active: ${s.active}  Used: ${s.used}  Expired: ${s.expired}\n`);
    }
}

// ============================================================
// §18  ONE-OFF CLI EXECUTION
// ============================================================

async function runOneOff(params) {
    const [cmd, ...args] = params;
    const commands = {
        'voucher': () => cliCommandRegistry.voucher(args),
        'redeem': () => cliCommandRegistry.redeem(args),
        'status': () => cliCommandRegistry.status(),
        'batch-vouchers': () => cliCommandRegistry['batch-vouchers'](args),
    };
    if (commands[cmd]) {
        try { await commands[cmd](); }
        catch (err) { console.error('Error:', err.message); }
    } else {
        console.log(`Unknown command: ${cmd}\nAvailable: ${Object.keys(commands).join(', ')}`);
    }
    mikrotik.disconnect();
    setTimeout(() => process.exit(0), 100);
}

// ============================================================
// §19  DAEMON BOOTSTRAP
// ============================================================

async function bootDaemon() {
    // Connect to MikroTik — failures are non-fatal (limited mode)
    try { await mikrotik.connect(); }
    catch (err) { logger.warn(`Starting in limited mode — MikroTik unreachable: ${err.message}`); }

    const expressServer = http.createServer(app);

    // Gateway: separate port if configured, otherwise share Express server
    let gateway;
    if (CONFIG.GATEWAY.PORT !== CONFIG.SERVER.PORT) {
        const gwServer = http.createServer((req, res) => {
            const corsH = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };

            if (req.url === '/' || req.url === '/index.html') {
                const htmlPath = path.join(__dirname, 'index.html');
                fs.readFile(htmlPath, (err, data) => {
                    if (err) { res.writeHead(404, corsH); res.end('index.html not found'); return; }
                    res.writeHead(200, { 'Content-Type': 'text/html', ...corsH });
                    res.end(data);
                });
                return;
            }
            if (req.url === '/api/token') {
                res.writeHead(200, { 'Content-Type': 'application/json', ...corsH });
                res.end(JSON.stringify({
                    token: CONFIG.GATEWAY.TOKEN,
                    wsPort: CONFIG.GATEWAY.PORT,
                    apiPort: CONFIG.SERVER.PORT,
                }));
                return;
            }
            res.writeHead(404, corsH); res.end('Not found');
        });

        gateway = new AgentOSGateway(gwServer);
        gwServer.listen(CONFIG.GATEWAY.PORT, CONFIG.GATEWAY.HOST, () => {
            logger.info(`WS Gateway  → ws://${CONFIG.GATEWAY.HOST}:${CONFIG.GATEWAY.PORT}${CONFIG.GATEWAY.WS_PATH}`);
            logger.info(`Dashboard   → http://localhost:${CONFIG.GATEWAY.PORT}/index.html`);
        });
    } else {
        gateway = new AgentOSGateway(expressServer);
    }

    const bot = new AgentOSBot();
    const monitor = new SystemMonitor(mikrotik, bot);
    monitor.start(30_000);
    new AgentOSOrchestrator(mikrotik, database, gateway, bot);

    expressServer.listen(CONFIG.SERVER.PORT, CONFIG.SERVER.HOST, () => {
        logger.info(`${BRAND.name} v${BRAND.version} → http://${CONFIG.SERVER.HOST}:${CONFIG.SERVER.PORT}`);
        logger.info(`Health check → http://${CONFIG.SERVER.HOST}:${CONFIG.SERVER.PORT}/health`);
    });

    const shutdown = (sig) => {
        logger.info(`${sig} received — shutting down gracefully`);
        gateway.closeAll();
        mikrotik.disconnect();
        expressServer.close(() => process.exit(0));
        setTimeout(() => process.exit(1), 5000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('uncaughtException', (err) => { logger.error('Uncaught exception:', err); process.exit(1); });
    process.on('unhandledRejection', (reason) => { logger.error('Unhandled rejection:', reason); });
}

// ============================================================
// §20  ENTRY POINT
// ============================================================

if (IS_CLI) {
    const cliArgs = ARGS.slice(1);
    cliArgs.length > 0 ? runOneOff(cliArgs) : new CLI().start();
} else {
    bootDaemon().catch(err => { logger.error('Fatal boot error:', err); process.exit(1); });
}
