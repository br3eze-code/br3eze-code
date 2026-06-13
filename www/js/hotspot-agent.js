#!/usr/bin/env node
// ==========================================
// AGENTOS - Agent Operating System
// Version: 2026.3.27 (Refactored & Secured)
// ==========================================

require('dotenv').config();
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
const path = require('path');
const fs = require('fs');

// ==========================================
// BRANDING & CONFIGURATION
// ==========================================

const BRAND = {
    name: 'AgentOS',
    version: '2026.3.27',
    emoji: '🤖',
    tagline: "Network Intelligence, Simplified"
};

const CONFIG = {
    MIKROTIK: {
        IP: process.env.MIKROTIK_IP || '192.168.88.1',
        USER: process.env.MIKROTIK_USER || 'admin',
        PASS: process.env.MIKROTIK_PASS,
        PORT: process.env.MIKROTIK_PORT || 8728,
        RECONNECT_INTERVAL: 5000,
        MAX_RECONNECT_ATTEMPTS: 10
    },
    TELEGRAM: {
        TOKEN: process.env.TELEGRAM_TOKEN,
        ALLOWED_CHATS: process.env.ALLOWED_CHAT_IDS ? process.env.ALLOWED_CHAT_IDS.split(',') : []
    },
    GATEWAY: {
        PORT: process.env.GATEWAY_PORT || 19876,
        HOST: process.env.GATEWAY_HOST || '127.0.0.1',
        TOKEN: process.env.AGENTOS_GATEWAY_TOKEN || require('crypto').randomBytes(32).toString('hex'),
        WS_PATH: '/ws'
    },
    SERVER: {
        PORT: process.env.PORT || 3000,
        HOST: process.env.HOST || '0.0.0.0',
        NODE_ENV: process.env.NODE_ENV || 'development'
    },
    SECURITY: {
        RATE_LIMIT_WINDOW: 15 * 60 * 1000,
        RATE_LIMIT_MAX: 100
    }
};

if (!CONFIG.MIKROTIK.PASS) throw new Error('MIKROTIK_PASS environment variable required');
if (!CONFIG.TELEGRAM.TOKEN) throw new Error('TELEGRAM_TOKEN environment variable required');

// ==========================================
// LOGGER SETUP
// ==========================================

const logger = winston.createLogger({
    level: CONFIG.SERVER.NODE_ENV === 'production' ? 'info' : 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ level, message }) => `${BRAND.emoji} [${BRAND.name}] ${level}: ${message}`)
            )
        })
    ]
});

// ==========================================
// DATABASE LAYER (Firebase + Local Fallback)
// ==========================================

class Database {
    constructor() {
        this.db = null;
        this.localFallback = new Map();
        this.init();
    }

    init() {
        try {
            if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
                // Fix for OpenSSL 3.0+ Decoder routines unsupported error
                const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/"/g, '');
                admin.initializeApp({
                    credential: admin.credential.cert({
                        projectId: process.env.FIREBASE_PROJECT_ID,
                        privateKey: privateKey,
                        clientEmail: process.env.FIREBASE_CLIENT_EMAIL
                    })
                });
                this.db = admin.firestore();
                logger.info('Firebase initialized successfully');
            } else {
                throw new Error("Missing Firebase credentials");
            }
        } catch (error) {
            logger.error(`Firebase init failed (${error.message}), using file fallback`);
            this.loadLocalData();
        }
    }

    loadLocalData() {
        try {
            const dataPath = './data/vouchers.json';
            if (fs.existsSync(dataPath)) {
                const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                Object.entries(data).forEach(([k, v]) => this.localFallback.set(k, v));
            }
        } catch (error) {
            logger.error('Failed to load local data:', error.message);
        }
    }

    saveLocalData() {
        if (!this.db) {
            try {
                if (!fs.existsSync('./data')) fs.mkdirSync('./data');
                const data = Object.fromEntries(this.localFallback);
                fs.writeFileSync('./data/vouchers.json', JSON.stringify(data, null, 2));
            } catch (error) {
                logger.error('Failed to save local data:', error.message);
            }
        }
    }

    async getVoucher(code) {
        if (this.db) {
            const doc = await this.db.collection('vouchers').doc(code).get();
            return doc.exists ? doc.data() : null;
        }
        return this.localFallback.get(code) || null;
    }

    async createVoucher(code, data) {
        const voucherData = {
            ...data,
            createdAt: this.db ? admin.firestore.FieldValue.serverTimestamp() : new Date(),
            used: false
        };

        if (this.db) {
            await this.db.collection('vouchers').doc(code).set(voucherData);
        } else {
            this.localFallback.set(code, voucherData);
            this.saveLocalData();
        }
        return voucherData;
    }

    async redeemVoucher(code, userData) {
        const updateData = {
            used: true,
            redeemedAt: this.db ? admin.firestore.FieldValue.serverTimestamp() : new Date(),
            redeemedBy: userData
        };

        if (this.db) {
            await this.db.collection('vouchers').doc(code).update(updateData);
        } else {
            const voucher = this.localFallback.get(code);
            if (voucher) {
                this.localFallback.set(code, { ...voucher, ...updateData });
                this.saveLocalData();
            }
        }
    }

    async getStats() {
        if (this.db) {
            const snapshot = await this.db.collection('vouchers').get();
            const vouchers = snapshot.docs.map(d => d.data());
            return {
                total: vouchers.length,
                used: vouchers.filter(v => v.used).length,
                active: vouchers.filter(v => !v.used).length
            };
        }
        const vouchers = Array.from(this.localFallback.values());
        return {
            total: vouchers.length,
            used: vouchers.filter(v => v.used).length,
            active: vouchers.filter(v => !v.used).length
        };
    }
}

const database = new Database();

// ==========================================
// MIKROTIK MANAGER
// ==========================================

class MikroTikManager {
    constructor() {
        this.conn = null;
        this.isConnected = false;
        this.api = new RouterOSClient({
            host: CONFIG.MIKROTIK.IP,
            user: CONFIG.MIKROTIK.USER,
            password: CONFIG.MIKROTIK.PASS,
            port: CONFIG.MIKROTIK.PORT,
            timeout: 10000
        });
        this.tools = new Map();
        this.registerTools();
    }

    registerTools() {
        this.tools.set('user.add', this.addHotspotUser.bind(this));
        this.tools.set('user.remove', this.removeHotspotUser.bind(this));
        this.tools.set('user.kick', this.kickUser.bind(this));
        this.tools.set('user.status', this.getUserStatus.bind(this));
        this.tools.set('users.active', this.getActiveUsers.bind(this));
        this.tools.set('users.all', this.getAllHotspotUsers.bind(this));
        this.tools.set('system.stats', this.getSystemStats.bind(this));
        this.tools.set('system.logs', this.getLogs.bind(this));
        this.tools.set('system.reboot', this.reboot.bind(this));
        this.tools.set('ping', this.ping.bind(this));
        this.tools.set('firewall.list', this.getFirewallRules.bind(this));
        this.tools.set('firewall.block', this.addToBlockList.bind(this));
    }

    async connect() {
        try {
            this.conn = await this.api.connect();
            this.isConnected = true;
            logger.info('MikroTik connected successfully');
        } catch (error) {
            this.isConnected = false;
            logger.error('MikroTik connection failed:', error.message);
        }
    }

    async addHotspotUser(username, password, profile = 'default') {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        if (!username) throw new Error('Username is required');

        const existing = await this.conn.menu('/ip/hotspot/user').where('name', username).get();
        if (existing.length > 0) {
            await this.conn.menu('/ip/hotspot/user').update(existing[0]['.id'], { password, profile, disabled: 'no' });
            return { action: 'updated', username };
        } else {
            await this.conn.menu('/ip/hotspot/user').add({ name: username, password, profile });
            return { action: 'created', username };
        }
    }

    async removeHotspotUser(username) {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        if (!username) throw new Error('Username is required');
        const users = await this.conn.menu('/ip/hotspot/user').where('name', username).get();
        if (users.length > 0) {
            await this.conn.menu('/ip/hotspot/user').remove(users[0]['.id']);
            return { action: 'removed', username };
        }
        throw new Error('User not found');
    }

    async getAllHotspotUsers() {
        if (!this.isConnected) return [];
        return await this.conn.menu('/ip/hotspot/user').get();
    }

    async getActiveUsers() {
        if (!this.isConnected) return [];
        return await this.conn.menu('/ip/hotspot/active').get();
    }

    async getUserStatus(username) {
        if (!this.isConnected) return null;
        if (!username) throw new Error('Username is required');
        const active = await this.conn.menu('/ip/hotspot/active').where('user', username).get();
        return active.length > 0 ? active[0] : null;
    }

    async kickUser(username) {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        if (!username) throw new Error('Username is required');
        const active = await this.conn.menu('/ip/hotspot/active').where('user', username).get();
        if (active.length > 0) {
            await this.conn.menu('/ip/hotspot/active').remove(active[0]['.id']);
            return true;
        }
        return false;
    }

    async getSystemStats() {
        if (!this.isConnected) return null;
        const resources = await this.conn.menu('/system/resource').get();
        return resources[0];
    }

    async getLogs(lines = 10) {
        if (!this.isConnected) return [];
        const logs = await this.conn.menu('/log').get();
        return logs.slice(-lines);
    }

    async reboot() {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        // Fallback for routeros-client exec issues
        try {
            await this.conn.write(['/system/reboot']);
        } catch (e) { /* write will drop connection, throwing error */ }
        return { status: 'rebooting' };
    }

    async ping(host, count = 4) {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        if (!host) throw new Error('Host parameter is required');
        // Native RouterOS API array command
        return await this.conn.write(['/ping', `=address=${host}`, `=count=${count}`]);
    }

    async getFirewallRules(type = 'filter') {
        if (!this.isConnected) return [];
        return await this.conn.menu(`/ip/firewall/${type}`).get();
    }

    async addToBlockList(target, list = 'blocked') {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        if (!target) throw new Error('Target parameter is required');
        await this.conn.menu('/ip/firewall/address-list').add({
            list: list,
            address: target,
            comment: 'Blocked via AgentOS'
        });
        return { action: 'blocked', target };
    }

    async executeTool(toolName, ...args) {
        const tool = this.tools.get(toolName);
        if (!tool) throw new Error(`Tool not found: ${toolName}`);
        return await tool(...args);
    }

    getAvailableTools() {
        return Array.from(this.tools.keys());
    }
}

const mikrotik = new MikroTikManager();

// ==========================================
// WEBSOCKET GATEWAY
// ==========================================

class AgentOSGateway {
    constructor(server) {
        this.wss = new WebSocket.Server({ server, path: CONFIG.GATEWAY.WS_PATH });
        this.clients = new Map();
        this.setupHandlers();
    }

    setupHandlers() {
        this.wss.on('connection', (ws, req) => {
            const token = req.url.includes('token=') ? new URLSearchParams(req.url.split('?')[1]).get('token') : null;
            if (token !== CONFIG.GATEWAY.TOKEN) return ws.close(4001, 'Unauthorized');

            const clientId = require('crypto').randomUUID();
            this.clients.set(clientId, { ws });

            ws.send(JSON.stringify({ type: 'hello', version: BRAND.version }));

            ws.on('message', async (data) => {
                try {
                    const message = JSON.parse(data);
                    if (message.type === 'tool.invoke') {
                        const result = await mikrotik.executeTool(message.tool.replace('mikrotik.', ''), ...(message.params || []));
                        ws.send(JSON.stringify({ type: 'tool.result', id: message.id, result }));
                    }
                } catch (error) {
                    ws.send(JSON.stringify({ type: 'tool.error', error: error.message }));
                }
            });

            ws.on('close', () => this.clients.delete(clientId));
        });
    }

    broadcast(payload) {
        this.clients.forEach(({ ws }) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'broadcast', payload }));
        });
    }
}

// ==========================================
// TELEGRAM BOT
// ==========================================

class AgentOSBot {
    constructor() {
        this.bot = new TelegramBot(CONFIG.TELEGRAM.TOKEN, { polling: true });
        this.setupHandlers();
    }

    checkAuth(msg) {
        const chatId = msg.chat.id.toString();
        if (CONFIG.TELEGRAM.ALLOWED_CHATS.length > 0 && !CONFIG.TELEGRAM.ALLOWED_CHATS.includes(chatId)) {
            this.bot.sendMessage(msg.chat.id, "⛔ *Unauthorized*", { parse_mode: "Markdown" });
            return false;
        }
        return true;
    }

    setupHandlers() {
        this.bot.onText(/\/start/, this.handleStart.bind(this));
        this.bot.onText(/\/dashboard/, this.handleDashboard.bind(this));
        this.bot.onText(/\/tools/, this.handleTools.bind(this));
        this.bot.onText(/\/network/, this.handleNetwork.bind(this));
        this.bot.onText(/\/users/, this.handleUsers.bind(this));
        this.bot.onText(/\/status/, this.handleStatus.bind(this));
        this.bot.onText(/\/voucher(?: (.+))?/, this.handleVoucher.bind(this));

        // Command for executing tools directly with parameters
        this.bot.onText(/\/tool (.+)/, async (msg, match) => {
            if (!this.checkAuth(msg)) return;
            const args = match[1].split(' ');
            const toolName = args.shift();
            try {
                const result = await mikrotik.executeTool(toolName, ...args);
                await this.bot.sendMessage(msg.chat.id, `✅ *Tool Result: ${toolName}*\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``, { parse_mode: "Markdown" });
            } catch (error) {
                await this.bot.sendMessage(msg.chat.id, `❌ Tool failed: ${error.message}`);
            }
        });

        this.bot.on('callback_query', this.handleCallback.bind(this));
        this.bot.on('polling_error', (err) => logger.error('Telegram polling error:', err));
    }

    async handleStart(msg) {
        if (!this.checkAuth(msg)) return;
        const text = `${BRAND.emoji} *${BRAND.name} ${BRAND.version}*\n_"${BRAND.tagline}"_\n\nSelect an action:`;
        const keyboard = {
            inline_keyboard: [
                [{ text: "📊 Dashboard", callback_data: "action:dashboard" }, { text: "🛠 Tools", callback_data: "action:tools" }],
                [{ text: "👥 Users", callback_data: "action:users" }, { text: "🌐 Network", callback_data: "action:network" }],
                [{ text: "🎫 Voucher", callback_data: "action:voucher" }, { text: "📈 Status", callback_data: "action:status" }]
            ]
        };
        await this.bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown", reply_markup: keyboard });
    }

    async handleDashboard(msg) {
        if (!this.checkAuth(msg)) return;
        try {
            const [dbStats, routerStats] = await Promise.all([database.getStats(), mikrotik.getSystemStats()]);
            const text = `📊 *Dashboard*\n\n*Router:* CPU: ${routerStats?.['cpu-load'] || 'N/A'}% | Uptime: ${routerStats?.uptime || 'N/A'}\n*Vouchers:* Total: ${dbStats.total} | Used: ${dbStats.used}`;
            await this.bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
        } catch (error) {
            this.bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
        }
    }

    async handleTools(msg) {
        if (!this.checkAuth(msg)) return;
        const chunked = [];
        const tools = mikrotik.getAvailableTools();
        for (let i = 0; i < tools.length; i += 2) {
            chunked.push(tools.slice(i, i + 2).map(t => ({ text: `🔧 ${t}`, callback_data: `tool:${t}` })));
        }
        await this.bot.sendMessage(msg.chat.id, `${BRAND.emoji} *Available Tools*`, { parse_mode: "Markdown", reply_markup: { inline_keyboard: chunked } });
    }

    async handleNetwork(msg) {
        if (!this.checkAuth(msg)) return;
        const keyboard = {
            inline_keyboard: [
                [{ text: "📡 Ping Test", callback_data: "net:ping" }, { text: "🔥 Firewall", callback_data: "net:firewall" }],
                [{ text: "⚡ Reboot Router", callback_data: "confirm:reboot" }]
            ]
        };
        await this.bot.sendMessage(msg.chat.id, `🌐 *Network Operations*`, { parse_mode: "Markdown", reply_markup: keyboard });
    }

    async handleUsers(msg) {
        if (!this.checkAuth(msg)) return;
        const keyboard = {
            inline_keyboard: [
                [{ text: "👁 View Active", callback_data: "users:active" }, { text: "📋 All Users", callback_data: "users:all" }]
            ]
        };
        await this.bot.sendMessage(msg.chat.id, `👥 *User Management*`, { parse_mode: "Markdown", reply_markup: keyboard });
    }

    async handleStatus(msg) {
        if (!this.checkAuth(msg)) return;
        await this.bot.sendMessage(msg.chat.id, `🟢 *Status*\nMikroTik: ${mikrotik.isConnected ? 'Connected' : 'Disconnected'}\nDatabase: ${database.db ? 'Firebase' : 'Local'}`, { parse_mode: "Markdown" });
    }

    async handleVoucher(msg, match) {
        if (!this.checkAuth(msg)) return;
        const plan = match ? match[1] : null;

        if (!plan) {
            const kb = {
                inline_keyboard: [
                    [{ text: "⏱ 1 Hour", callback_data: "voucher:1h" }, { text: "📅 1 Day", callback_data: "voucher:1d" }]
                ]
            };
            return this.bot.sendMessage(msg.chat.id, `🎫 *Create Voucher*\nSelect duration:`, { parse_mode: "Markdown", reply_markup: kb });
        }
        await this.createVoucher(msg.chat.id, plan);
    }

    // --- CALLBACK HANDLER ---
    async handleCallback(query) {
        const chatId = query.message.chat.id;
        const data = query.data;

        try {
            await this.bot.answerCallbackQuery(query.id);
            const [category, action] = data.split(':');
            const fakeMsg = { chat: { id: chatId }, from: query.from };

            switch (category) {
                case 'action':
                    if (action === 'dashboard') await this.handleDashboard(fakeMsg);
                    if (action === 'tools') await this.handleTools(fakeMsg);
                    if (action === 'network') await this.handleNetwork(fakeMsg);
                    if (action === 'users') await this.handleUsers(fakeMsg);
                    if (action === 'voucher') await this.handleVoucher(fakeMsg, null);
                    if (action === 'status') await this.handleStatus(fakeMsg);
                    break;
                case 'tool':
                    await this.handleToolButton(chatId, action);
                    break;
                case 'net':
                    await this.handleNetworkButton(chatId, action);
                    break;
                case 'users':
                    await this.handleUsersButton(chatId, action);
                    break;
                case 'voucher':
                    await this.createVoucher(chatId, action);
                    break;
                case 'confirm':
                    if (action === 'reboot') {
                        await mikrotik.reboot();
                        await this.bot.sendMessage(chatId, "✅ Reboot command sent.");
                    }
                    break;
            }
        } catch (error) {
            logger.error('Callback error:', error);
            await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }

    async handleToolButton(chatId, toolName) {
        const toolConfig = {
            'user.status': { params: ['username'] },
            'user.kick': { params: ['username'] },
            'user.remove': { params: ['username'] },
            'system.logs': { params: ['lines'] },
            'ping': { params: ['host', 'count'] },
            'firewall.block': { params: ['target_ip'] }
        };

        const config = toolConfig[toolName];
        if (!config || config.params.length === 0) {
            try {
                const result = await mikrotik.executeTool(toolName);
                await this.bot.sendMessage(chatId, `✅ *Result: ${toolName}*\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``, { parse_mode: "Markdown" });
            } catch (e) {
                await this.bot.sendMessage(chatId, `❌ Tool failed: ${e.message}`);
            }
        } else {
            await this.bot.sendMessage(chatId, `🔧 *Tool: ${toolName}*\nParameters needed: ${config.params.join(', ')}\n\nCommand format:\n\`/tool ${toolName} ${config.params.map(p => `[${p}]`).join(' ')}\``, { parse_mode: "Markdown" });
        }
    }

    async handleNetworkButton(chatId, action) {
        if (action === 'ping') await this.bot.sendMessage(chatId, `📡 Send: \`/tool ping <host>\``, { parse_mode: "Markdown" });
        if (action === 'firewall') {
            const rules = await mikrotik.getFirewallRules();
            await this.bot.sendMessage(chatId, `🔥 *Firewall Rules*\n${rules.slice(0, 5).map(r => `• ${r.action}`).join('\n')}`, { parse_mode: "Markdown" });
        }
    }

    async handleUsersButton(chatId, action) {
        if (action === 'active') {
            const users = await mikrotik.getActiveUsers();
            await this.bot.sendMessage(chatId, `👥 *Active Users (${users.length})*\n${users.map(u => `• ${u.user}`).join('\n')}`, { parse_mode: "Markdown" });
        }
        if (action === 'all') {
            const users = await mikrotik.getAllHotspotUsers();
            await this.bot.sendMessage(chatId, `📋 *All Users (${users.length})*\n${users.slice(0, 10).map(u => `• ${u.name}`).join('\n')}`, { parse_mode: "Markdown" });
        }
    }

    async createVoucher(chatId, plan) {
        try {
            const code = "STAR-" + Math.random().toString(36).substr(2, 6).toUpperCase();
            await database.createVoucher(code, { plan, createdBy: 'telegram' });

            const qrData = JSON.stringify({ code, plan, url: `http://localhost:3000/login.html?code=${code}` });
            const qrBuffer = await QRCode.toBuffer(qrData);

            await this.bot.sendPhoto(chatId, qrBuffer, {
                caption: `🎟 *Voucher Created*\nCode: \`${code}\`\nPlan: ${plan}`,
                parse_mode: "Markdown"
            });
        } catch (error) {
            await this.bot.sendMessage(chatId, `❌ Failed to create voucher: ${error.message}`);
        }
    }
}

// ==========================================
// EXPRESS HTTP API
// ==========================================

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(rateLimit({ windowMs: CONFIG.SECURITY.RATE_LIMIT_WINDOW, max: CONFIG.SECURITY.RATE_LIMIT_MAX }));

// --- SECURE TOOL EXECUTION ENDPOINT ---
const requireAuth = (req, res, next) => {
    const token = req.headers['x-api-token'] || req.query.token;
    if (token !== CONFIG.GATEWAY.TOKEN) return res.status(401).json({ error: "Unauthorized access" });
    next();
};

app.post('/tool/execute', requireAuth, async (req, res) => {
    try {
        const { tool, params } = req.body;
        if (!tool || !mikrotik.getAvailableTools().includes(tool)) {
            return res.status(400).json({ error: "Invalid tool" });
        }
        const result = await mikrotik.executeTool(tool, ...(params || []));
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/health', async (req, res) => {
    res.json({ status: 'ok', version: BRAND.version, mikrotik: mikrotik.isConnected });
});

// ==========================================
// SERVER INITIALIZATION
// ==========================================

let gateway;
let telegramBot;

async function startServer() {
    await mikrotik.connect();

    const server = http.createServer(app);
    gateway = new AgentOSGateway(server);
    telegramBot = new AgentOSBot();

    server.listen(CONFIG.SERVER.PORT, CONFIG.SERVER.HOST, () => {
        logger.info(`${BRAND.name} v${BRAND.version} running on port ${CONFIG.SERVER.PORT}`);
        logger.info(`Gateway Token: ${CONFIG.GATEWAY.TOKEN}`);
    });
}

process.on('SIGINT', async () => {
    await database.saveLocalData();
    process.exit(0);
});

startServer().catch(err => logger.error('Startup failed:', err));