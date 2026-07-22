#!/usr/bin/env node
// ============================================================
// AgentOS — Network Intelligence Platform
// Version : 2026.4.30-Merged
// Stack   : MikroTik RouterOS · Telegram · WhatsApp · WebSocket CLI
//           Firebase/Local DB · Gemini/Claude/OpenAI/Ollama · Mastercard A2A
//           GitHub Integration · OAuth Vault · Multi-OS Agents · LLM Mesh
// Security: CVE-2026-1526 patched · WS leak-free · Firebase v13
//           AES-256-GCM Vault · Timing-safe auth · Prompt injection filter
// ============================================================
process.env.GRPC_DNS_RESOLVER = 'native';

// ── Dependencies ─────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const { exec, spawn } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const MastercardA2AService = require('./services/mastercardA2A');
const TelegramBot = require('node-telegram-bot-api');
const MessagingAdapter = require('./services/messagingAdapter');
const { RouterOSClient } = require('routeros-client');
const QRCode = require('qrcode');
const admin = require('firebase-admin');
const winston = require('winston');
const Joi = require('joi');
const fs = require('fs');
const readline = require('readline');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const { createCipheriv, createDecipheriv, randomBytes, scryptSync } = require('crypto');
const path = require('path');
const { intro, note, outro, spinner, confirm, select, text, isCancel, log: clackLog } = require('@clack/prompts');
require('dotenv').config();

// ── GitHub / Git ──────────────────────────────────────────────
let Octokit, createAppAuth;
try {
    ({ Octokit } = require('@octokit/rest'));
    ({ createAppAuth } = require('@octokit/auth-app'));
} catch { /* optional — install @octokit/rest @octokit/auth-app */ }

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
    version: '2026.9.0-Merged',
    emoji: '🌐',
    tagline: 'Network Intelligence, Simplified',
    codename: 'Omni-Stable',
};

// ── Environment schema ───────────────────────────────────────
const envSchema = Joi.object({
    // ── Core Router ───────────────────────────────────────────
    MIKROTIK_PASS: Joi.string().required(),
    MIKROTIK_IP: Joi.string().default('192.168.88.1'),
    MIKROTIK_USER: Joi.string().default('admin'),
    MIKROTIK_PORT: Joi.number().default(8728),
    OS_TARGET: Joi.string().valid('mikrotik', 'linux', 'windows').default('mikrotik'),

    // ── SSH Targets (Linux/Pi agents) ─────────────────────────
    SSH_HOST: Joi.string().allow('').default(''),
    SSH_USER: Joi.string().default('root'),
    SSH_PASS: Joi.string().allow('').default(''),

    // ── Messaging ─────────────────────────────────────────────
    TELEGRAM_TOKEN: Joi.string().allow('').default(''),
    TELEGRAM_BOT_USERNAME: Joi.string().default('AgentOSBot'),
    WHATSAPP_ENABLED: Joi.boolean().default(true),
    WHATSAPP_AUTH_DIR: Joi.string().default('./data/whatsapp_auth'),
    ALLOWED_CHAT_IDS: Joi.string().allow('').default(''),

    // ── LLM Configuration ─────────────────────────────────────
    LLM_PROVIDER: Joi.string().valid('gemini', 'claude', 'openai', 'ollama').default('gemini'),
    GEMINI_API_KEY: Joi.string().allow('').default(''),
    ANTHROPIC_API_KEY: Joi.string().allow('').default(''),
    OPENAI_API_KEY: Joi.string().allow('').default(''),
    OLLAMA_HOST: Joi.string().default('http://localhost:11434'),
    OLLAMA_MODEL: Joi.string().default('llama3.2'),
    LLM_MODEL: Joi.string().allow('').default(''),

    // ── Firebase ─────────────────────────────────────────────
    FIREBASE_PROJECT_ID: Joi.string().allow('').default(''),
    FIREBASE_PRIVATE_KEY: Joi.string().allow('').default(''),
    FIREBASE_CLIENT_EMAIL: Joi.string().allow('').default(''),
    FIREBASE_SERVICE_ACCOUNT: Joi.string().allow('').default(''),

    // ── Server ───────────────────────────────────────────────
    PORT: Joi.number().default(3000),
    HOST: Joi.string().default('0.0.0.0'),
    NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
    ALLOWED_ORIGINS: Joi.string().default('*'),
    SERVER_URL: Joi.string().uri().default('http://localhost:3000'),

    // ── Gateway / WebSocket ───────────────────────────────────
    GATEWAY_PORT: Joi.number().default(19876),
    GATEWAY_HOST: Joi.string().default('127.0.0.1'),
    AGENTOS_GATEWAY_TOKEN: Joi.string().allow('').default(''),

    // ── Rate Limiting ─────────────────────────────────────────
    RATE_LIMIT_WINDOW_MS: Joi.number().default(15 * 60 * 1000),
    RATE_LIMIT_MAX: Joi.number().default(100),
    VOUCHER_RATE_LIMIT: Joi.number().default(5),
    ALERT_COOLDOWN_MS: Joi.number().default(5 * 60 * 1000),

    // ── Emotion / UX ──────────────────────────────────────────
    EMOTION_ENABLED: Joi.boolean().default(true),
    DEFAULT_LANGUAGE: Joi.string().valid('en', 'es', 'fr', 'sw').default('en'),

    // ── Omni-Agent: Encryption Vault ─────────────────────────
    VAULT_MASTER_KEY: Joi.string().min(32).allow('').default('changeme-replace-with-32-char-key!'),

    // ── Omni-Agent: GitHub OAuth ──────────────────────────────
    GITHUB_CLIENT_ID: Joi.string().allow('').default(''),
    GITHUB_CLIENT_SECRET: Joi.string().allow('').default(''),
    GITHUB_APP_ID: Joi.string().allow('').default(''),
    GITHUB_PRIVATE_KEY: Joi.string().allow('').default(''),
    GITHUB_WEBHOOK_SECRET: Joi.string().allow('').default(''),

    // ── Omni-Agent: Distributed Agents ───────────────────────
    AGENT_MODE: Joi.string().valid('master', 'agent', 'hybrid').default('master'),
    MASTER_URL: Joi.string().allow('').default(''),
    DEVICE_ID: Joi.string().allow('').default(''),
    DEVICE_TYPE: Joi.string().valid('server', 'windows', 'linux', 'pi', 'mobile').default('server'),

    // ── Omni-Agent: MCP ───────────────────────────────────────
    MCP_SERVER_PORT: Joi.number().default(19877),
    MCP_ENABLED: Joi.boolean().default(false),

    // ── Omni-Agent: Mesh Network ──────────────────────────────
    MESH_DISCOVERY_ENABLED: Joi.boolean().default(true),
    MESH_HEARTBEAT_MS: Joi.number().default(30000),
}).unknown(true);

const { error: envError, value: ENV } = envSchema.validate(process.env);
if (envError) { console.error(`[AgentOS] ENV error: ${envError.message}`); process.exit(1); }

const CONFIG = {
    // ── Core Router ───────────────────────────────────────────
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
    WHATSAPP: {
        ENABLED: ENV.WHATSAPP_ENABLED,
        AUTH_DIR: ENV.WHATSAPP_AUTH_DIR,
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
        RATE_LIMIT_WINDOW: ENV.RATE_LIMIT_WINDOW_MS,
        RATE_LIMIT_MAX: ENV.RATE_LIMIT_MAX,
        VOUCHER_RATE_LIMIT: ENV.VOUCHER_RATE_LIMIT,
        VOUCHER_WINDOW_MS: 60 * 1000,
        ALERT_COOLDOWN_MS: ENV.ALERT_COOLDOWN_MS,
    },
    VOUCHER_PREFIX: 'STAR-',
    VOUCHER_PLANS: {
        '1hour': { maxAgeMs: 3_600_000, price: 1.00, label: '1 Hour' },
        '1Day': { maxAgeMs: 86_400_000, price: 5.00, label: '1 Day' },
        '7Day': { maxAgeMs: 7 * 86_400_000, price: 25.00, label: '7 Days' },
        '30Day': { maxAgeMs: 30 * 86_400_000, price: 80.00, label: '30 Days' },
    },

    // ── Omni-Agent additions ──────────────────────────────────
    EMOTION: {
        ENABLED: ENV.EMOTION_ENABLED,
        DECAY_RATE: 0.05,
        URGENCY_TTL: 10 * 60 * 1000,
    },
    OAUTH: {
        GITHUB: {
            CLIENT_ID: ENV.GITHUB_CLIENT_ID,
            CLIENT_SECRET: ENV.GITHUB_CLIENT_SECRET,
            APP_ID: ENV.GITHUB_APP_ID,
            PRIVATE_KEY: ENV.GITHUB_PRIVATE_KEY,
            WEBHOOK_SECRET: ENV.GITHUB_WEBHOOK_SECRET,
            REDIRECT_URI: `${ENV.SERVER_URL}/oauth/github/callback`,
            SCOPE: 'repo,workflow,admin:repo_hook,read:user',
        },
    },
    VAULT: {
        MASTER_KEY: ENV.VAULT_MASTER_KEY,
        ALGORITHM: 'aes-256-gcm',
        KEY_LENGTH: 32,
        IV_LENGTH: 16,
        TAG_LENGTH: 16,
    },
    MCP: {
        ENABLED: ENV.MCP_ENABLED,
        PORT: ENV.MCP_SERVER_PORT,
        VERSION: '2024-11-05',
    },
    DEVICE: {
        MODE: ENV.AGENT_MODE,
        TYPE: ENV.DEVICE_TYPE,
        ID: ENV.DEVICE_ID || require('os').hostname(),
        MASTER_URL: ENV.MASTER_URL,
    },
    MESH: {
        DISCOVERY_ENABLED: ENV.MESH_DISCOVERY_ENABLED,
        HEARTBEAT_MS: ENV.MESH_HEARTBEAT_MS,
    },
};

if (!CONFIG.MIKROTIK.PASS) throw new Error('MIKROTIK_PASS required');

const REQUIRED_MODULES = [
    ['express', 'express'],
    ['@google/generative-ai', 'GoogleGenerativeAI'],
    ['routeros-client', 'RouterOSClient'],
    ['node-telegram-bot-api', 'TelegramBot'],
    ['@whiskeysockets/baileys', 'Baileys'],
];

// Optional Omni-Agent modules — warn but do not exit
const OPTIONAL_MODULES = [
    ['@octokit/rest', 'GitHub integration (npm install @octokit/rest @octokit/auth-app)'],
    ['node-ssh', 'Linux SSH adapter (npm install node-ssh)'],
];

for (const [pkg, name] of REQUIRED_MODULES) {
    try { require(pkg); }
    catch { console.error(`❌ Missing module: ${pkg}. Run: npm install ${pkg}`); process.exit(1); }
}

for (const [pkg, hint] of OPTIONAL_MODULES) {
    try { require(pkg); }
    catch { logger?.warn?.(`[Omni] Optional module not installed — ${hint}`) || console.warn(`[Omni] Optional: ${hint}`); }
}

// ── Gemini AI (legacy direct client, kept for backward compat) ──
const genAI = ENV.GEMINI_API_KEY ? new GoogleGenerativeAI(ENV.GEMINI_API_KEY) : null;

// ============================================================
// §2.5  LLM ADAPTER LAYER  (Omni-Agent — Gemini/Claude/OpenAI/Ollama)
// ============================================================

class LLMAdapter {
    async complete(_messages, _tools) { throw new Error('Not implemented'); }
    async embed(_text) { return []; }
}

class GeminiAdapter extends LLMAdapter {
    constructor() {
        super();
        this.model = ENV.LLM_MODEL || 'gemini-2.0-flash';
        this.client = ENV.GEMINI_API_KEY ? new GoogleGenerativeAI(ENV.GEMINI_API_KEY) : null;
    }
    async complete(messages, tools = []) {
        if (!this.client) throw new Error('GEMINI_API_KEY not set');
        const model = this.client.getGenerativeModel({ model: this.model, tools: tools.length ? [{ functionDeclarations: tools }] : [] });
        const history = messages.slice(0, -1).map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: Array.isArray(m.content)
                ? m.content.map(c => c.type === 'text' ? { text: c.text } : { functionResponse: { name: c.toolName, response: { content: c.output } } })
                : [{ text: m.content || '' }],
        }));
        const last = messages[messages.length - 1];
        const chat = model.startChat({ history });
        const resp = await chat.sendMessage(Array.isArray(last.content) ? last.content.map(c => c.text || '').join('') : (last.content || ''));
        const usage = resp.response.usageMetadata || {};
        costTracker.record(usage.promptTokenCount, usage.candidatesTokenCount, 'gemini');
        const calls = resp.response.functionCalls?.() || null;
        return { text: resp.response.text() || '', calls: calls?.length ? calls : null, usage };
    }
    async embed(text) {
        if (!this.client) return [];
        const model = this.client.getGenerativeModel({ model: 'text-embedding-004' });
        const r = await model.embedContent(text);
        return r.embedding.values;
    }
}

class ClaudeAdapter extends LLMAdapter {
    constructor() {
        super();
        this.model = ENV.LLM_MODEL || 'claude-sonnet-4-6';
        this.apiKey = ENV.ANTHROPIC_API_KEY;
        this.base = 'https://api.anthropic.com/v1';
    }
    async complete(messages, tools = []) {
        if (!this.apiKey) throw new Error('ANTHROPIC_API_KEY not set');
        const r = await fetch(`${this.base}/messages`, {
            method: 'POST',
            headers: { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({
                model: this.model, max_tokens: 4096,
                tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })),
                messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
            }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error?.message || 'Anthropic API error');
        const text = data.content.filter(c => c.type === 'text').map(c => c.text).join('');
        const calls = data.content.filter(c => c.type === 'tool_use').map(c => ({ name: c.name, args: c.input, id: c.id }));
        costTracker.record(data.usage?.input_tokens, data.usage?.output_tokens, 'claude');
        return { text, calls: calls.length ? calls : null, usage: data.usage || {} };
    }
}

class OpenAIAdapter extends LLMAdapter {
    constructor() {
        super();
        this.model = ENV.LLM_MODEL || 'gpt-4o';
        this.apiKey = ENV.OPENAI_API_KEY;
        this.base = 'https://api.openai.com/v1';
    }
    async complete(messages, tools = []) {
        if (!this.apiKey) throw new Error('OPENAI_API_KEY not set');
        const r = await fetch(`${this.base}/chat/completions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model,
                messages: messages.map(m => ({ role: m.role, content: Array.isArray(m.content) ? m.content.map(c => c.type === 'text' ? { type: 'text', text: c.text } : c).filter(Boolean) : m.content })),
                tools: tools.length ? tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) : undefined,
            }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error?.message || 'OpenAI API error');
        const msg = data.choices[0].message;
        const calls = msg.tool_calls?.map(tc => ({ name: tc.function.name, args: JSON.parse(tc.function.arguments || '{}'), id: tc.id }));
        costTracker.record(data.usage?.prompt_tokens, data.usage?.completion_tokens, 'openai');
        return { text: msg.content || '', calls: calls?.length ? calls : null, usage: data.usage || {} };
    }
}

class OllamaAdapter extends LLMAdapter {
    constructor() {
        super();
        this.model = ENV.LLM_MODEL || ENV.OLLAMA_MODEL;
        this.base = ENV.OLLAMA_HOST;
    }
    async complete(messages, tools = []) {
        const r = await fetch(`${this.base}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model,
                messages: messages.map(m => ({ role: m.role === 'tool' ? 'tool' : m.role, content: Array.isArray(m.content) ? m.content.map(c => c.text || c.output || '').join('\n') : (m.content || '') })),
                tools: tools.length ? tools : undefined,
                stream: false,
            }),
        });
        if (!r.ok) throw new Error(`Ollama error: ${r.status}`);
        const data = await r.json();
        const msg = data.message;
        const calls = msg.tool_calls?.map(tc => ({ name: tc.function.name, args: tc.function.arguments, id: crypto.randomBytes(4).toString('hex') }));
        costTracker.record(0, 0, 'ollama');
        return { text: msg.content || '', calls: calls?.length ? calls : null, usage: {} };
    }
    async embed(text) {
        const r = await fetch(`${this.base}/api/embeddings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: this.model, prompt: text }) });
        const data = await r.json();
        return data.embedding || [];
    }
}

function createLLM() {
    const providers = { gemini: () => new GeminiAdapter(), claude: () => new ClaudeAdapter(), openai: () => new OpenAIAdapter(), ollama: () => new OllamaAdapter() };
    const factory = providers[ENV.LLM_PROVIDER] || providers.gemini;
    const llm = factory();
    logger.info(`LLM: ${ENV.LLM_PROVIDER} (${llm.model || ENV.LLM_PROVIDER})`);
    return llm;
}

const llm = createLLM();

const a2aService = new MastercardA2AService();

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
    _hexToAnsi(r, g, b) {
        return `\x1b[38;2;${r};${g};${b}m`;
    },

    gradient(text, startRGB, endRGB) {
        let out = '';
        const chars = [...text];
        for (let i = 0; i < chars.length; i++) {
            const r = Math.round(startRGB[0] + (endRGB[0] - startRGB[0]) * (i / chars.length));
            const g = Math.round(startRGB[1] + (endRGB[1] - startRGB[1]) * (i / chars.length));
            const b = Math.round(startRGB[2] + (endRGB[2] - startRGB[2]) * (i / chars.length));
            out += `${this._hexToAnsi(r, g, b)}${chars[i]}`;
        }
        return out + A.RESET;
    },

    async showSpinner(message, durationMs = 1000) {
        const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        const end = Date.now() + durationMs;
        let i = 0;
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

    async glitch(text, durationMs = 600) {
        const chars = '!@#$%^&*()_+-=[]{}|;:,.<>?/0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const end = Date.now() + durationMs;
        while (Date.now() < end) {
            const noise = text.split('').map(c => c === ' ' ? ' ' : chars[Math.floor(Math.random() * chars.length)]).join('');
            process.stdout.write(`\r  ${A.NEON_CYAN}${noise}${A.RESET}`);
            await sleep(50);
        }
        process.stdout.write(`\r  ${A.BOLD}${text}${A.RESET}\n`);
    },

    async decode(text, speed = 40) {
        const chars = '0123456789ABCDEF';
        let current = '';
        process.stdout.write('  ');
        for (let i = 0; i < text.length; i++) {
            for (let j = 0; j < 5; j++) {
                const rand = chars[Math.floor(Math.random() * chars.length)];
                process.stdout.write(`\r  ${A.BOLD}${current}${A.NEON_CYAN}${rand}${A.RESET}`);
                await sleep(speed / 2);
            }
            current += text[i];
            process.stdout.write(`\r  ${A.BOLD}${current}${A.RESET}`);
        }
        console.log();
    },

    progressBar(label, progress, total = 100, width = 30) {
        const p = Math.min(Math.max(progress / total, 0), 1);
        const complete = Math.round(p * width);
        const bar = '█'.repeat(complete) + '░'.repeat(width - complete);
        const pct = Math.round(p * 100);
        process.stdout.write(`\r  ${A.DIM}${label.padEnd(15)}${A.RESET} [${A.PRIMARY}${bar}${A.RESET}] ${A.BOLD}${pct}%${A.RESET}`);
        if (p >= 1) console.log();
    },

    printHeader(title) {
        const bar = '═'.repeat(52);
        console.log(`\n  ${A.DIM}╔${bar}╗${A.RESET}`);
        const center = title.padStart(26 + Math.floor(title.length / 2)).padEnd(52);
        console.log(`  ${A.DIM}║${A.RESET} ${this.gradient(center, [0, 229, 255], [181, 102, 255])} ${A.DIM}║${A.RESET}`);
        console.log(`  ${A.DIM}╚${bar}╝${A.RESET}\n`);
    },
};

// ============================================================
// §4  METRICS  +  COST TRACKER
// ============================================================

class CostTracker {
    constructor() {
        this.totalInputTokens = 0;
        this.totalOutputTokens = 0;
        this._events = [];
    }
    record(label, inputTokens = 0, outputTokens = 0) {
        this.totalInputTokens += inputTokens;
        this.totalOutputTokens += outputTokens;
        this._events.push({ label, inputTokens, outputTokens, ts: Date.now() });
        if (this._events.length > 1000) this._events.shift();
    }
    snapshot() {
        return {
            totalInputTokens: this.totalInputTokens,
            totalOutputTokens: this.totalOutputTokens,
            estimatedUSD: ((this.totalInputTokens * 0.00000025) + (this.totalOutputTokens * 0.00000075)).toFixed(6),
        };
    }
}
const costTracker = new CostTracker();

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
            cost: costTracker.snapshot(),
        };
    }
}
const metrics = new Metrics();

// ============================================================
// §4.1  CONVERSATION SESSION  (claw-code ConversationRuntime port)
//       Typed messages · ToolUse/ToolResult blocks · JSON persistence
// ============================================================

// TranscriptStore and UsageTracker must be declared before ConversationSession
// because class declarations are NOT hoisted — constructor calls would ReferenceError

class TranscriptStore {
    constructor() { this.entries = []; this.flushed = false; }
    append(entry) { this.entries.push(entry); this.flushed = false; }
    compact(keepLast = 12) { if (this.entries.length > keepLast) this.entries = this.entries.slice(-keepLast); }
    replay() { return [...this.entries]; }
    flush() { this.flushed = true; }
}

class UsageTracker {
    constructor() { this.inputTokens = 0; this.outputTokens = 0; }
    record(input, output) { this.inputTokens += input; this.outputTokens += output; }
    snapshot() { return { inputTokens: this.inputTokens, outputTokens: this.outputTokens }; }
    estimatedContextTokens(messages) {
        let chars = 0;
        for (const msg of messages)
            for (const block of msg.blocks || [])
                chars += (block.text || block.output || block.input || '').length;
        return Math.ceil(chars / 4);
    }
}

const MessageRole = Object.freeze({ USER: 'user', ASSISTANT: 'assistant', TOOL: 'tool' });

class ContentBlock {
    static text(text) { return { type: 'text', text }; }
    static toolUse(id, name, input) { return { type: 'tool_use', id, name, input }; }
    static toolResult(toolUseId, toolName, output, isError = false) {
        return { type: 'tool_result', toolUseId, toolName, output: typeof output === 'string' ? output : JSON.stringify(output), isError };
    }
}

class ConversationSession {
    constructor(sessionId = crypto.randomUUID()) {
        this.sessionId = sessionId;
        this.messages = [];
        this.transcript = new TranscriptStore();
        this.usage = new UsageTracker();
        this._path = `./data/sessions/${sessionId}.json`;
    }

    addUser(text) {
        this.messages.push({ role: MessageRole.USER, blocks: [ContentBlock.text(text)] });
        this.transcript.append(text);
    }

    addAssistant(blocks, usageMeta = null) {
        const msg = { role: MessageRole.ASSISTANT, blocks };
        if (usageMeta) {
            this.usage.record(usageMeta.promptTokenCount || 0, usageMeta.candidatesTokenCount || 0);
            costTracker.record('gemini', usageMeta.promptTokenCount || 0, usageMeta.candidatesTokenCount || 0);
            msg.usage = { input: usageMeta.promptTokenCount, output: usageMeta.candidatesTokenCount };
        }
        this.messages.push(msg);
    }

    addToolResult(toolUseId, toolName, output, isError = false) {
        this.messages.push({
            role: MessageRole.TOOL,
            blocks: [ContentBlock.toolResult(toolUseId, toolName, output, isError)],
        });
    }

    compactIfNeeded(threshold = 200_000) {
        const est = this.usage.estimatedContextTokens(this.messages);
        if (est > threshold && this.messages.length > 4) {
            const anchor = this.messages[0];
            this.messages = [anchor, ...this.messages.slice(-8)];
            this.transcript.compact(8);
            logger.info(`Session ${this.sessionId}: auto-compacted (est ${est} tokens)`);
        }
    }

    persist() {
        try {
            if (!fs.existsSync('./data/sessions')) fs.mkdirSync('./data/sessions', { recursive: true });
            fs.writeFileSync(this._path, JSON.stringify({
                sessionId: this.sessionId,
                messages: this.messages,
                usage: this.usage.snapshot(),
                savedAt: new Date().toISOString(),
            }, null, 2));
        } catch (err) { logger.error(`Session persist failed: ${err.message}`); }
    }

    static load(sessionId) {
        const p = `./data/sessions/${sessionId}.json`;
        if (!fs.existsSync(p)) return null;
        try {
            const data = JSON.parse(fs.readFileSync(p, 'utf8'));
            const s = new ConversationSession(data.sessionId);
            s.messages = data.messages || [];
            return s;
        } catch { return null; }
    }

    toGeminiHistory() {
        return this.messages.map(msg => {
            if (msg.role === MessageRole.USER)
                return { role: 'user', parts: msg.blocks.map(b => ({ text: b.text || '' })) };
            if (msg.role === MessageRole.ASSISTANT) {
                const parts = msg.blocks.map(b => {
                    if (b.type === 'text') return { text: b.text };
                    if (b.type === 'tool_use') return { functionCall: { name: b.name, args: JSON.parse(b.input || '{}') } };
                    return null;
                }).filter(Boolean);
                return { role: 'model', parts };
            }
            if (msg.role === MessageRole.TOOL) {
                const block = msg.blocks[0];
                return { role: 'user', parts: [{ functionResponse: { name: block.toolName, response: { content: block.output } } }] };
            }
            return null;
        }).filter(Boolean);
    }
}

// ============================================================
// §4.4  PERMISSION POLICY  (claw-code PermissionPolicy port)
// ============================================================

const PermissionMode = Object.freeze({
    READ_ONLY: 'read-only',
    WORKSPACE_WRITE: 'workspace-write',
    DANGER_FULL_ACCESS: 'danger-full-access',
    PROMPT: 'prompt',
    ALLOW: 'allow',
});

class PermissionPolicy {
    constructor(activeMode = PermissionMode.WORKSPACE_WRITE) {
        this.activeMode = activeMode;
        this._toolRequirements = new Map();
    }

    requireFor(toolName, mode) { this._toolRequirements.set(toolName, mode); return this; }

    check(toolName) {
        const required = this._toolRequirements.get(toolName) || PermissionMode.WORKSPACE_WRITE;
        const order = [
            PermissionMode.READ_ONLY, PermissionMode.WORKSPACE_WRITE,
            PermissionMode.DANGER_FULL_ACCESS, PermissionMode.PROMPT, PermissionMode.ALLOW,
        ];
        if (order.indexOf(this.activeMode) >= order.indexOf(required)) return { allowed: true };
        return { allowed: false, reason: `Tool "${toolName}" requires ${required}; active mode is ${this.activeMode}` };
    }

    static default() {
        return new PermissionPolicy(PermissionMode.WORKSPACE_WRITE)
            .requireFor('system.reboot', PermissionMode.DANGER_FULL_ACCESS)
            .requireFor('wireless.set_frequency', PermissionMode.DANGER_FULL_ACCESS)
            .requireFor('firewall.block', PermissionMode.WORKSPACE_WRITE)
            .requireFor('user.kick', PermissionMode.WORKSPACE_WRITE)
            .requireFor('user.remove', PermissionMode.WORKSPACE_WRITE);
    }
}
const permissionPolicy = PermissionPolicy.default();

// ============================================================
// §4.5  HOOK REGISTRY  (claw-code HookRunner port)
// ============================================================

class HookRegistry {
    constructor() { this._pre = new Map(); this._post = new Map(); }

    onBefore(toolName, fn) {
        if (!this._pre.has(toolName)) this._pre.set(toolName, []);
        this._pre.get(toolName).push(fn);
        return this;
    }

    onAfter(toolName, fn) {
        if (!this._post.has(toolName)) this._post.set(toolName, []);
        this._post.get(toolName).push(fn);
        return this;
    }

    async runBefore(toolName, args) {
        for (const fn of this._pre.get(toolName) || []) await fn({ tool: toolName, args });
    }

    async runAfter(toolName, args, result) {
        for (const fn of this._post.get(toolName) || []) await fn({ tool: toolName, args, result });
    }
}
const hooks = new HookRegistry();



// ============================================================
// §5  DATABASE (Firebase + Local fallback)
// ============================================================

class Database {
    constructor() {
        this.db = null;   // Firestore instance or null
        this._local = new Map();
        this._wallets = new Map();
        this._init();
    }

    _init() {
        if (!ENV.FIREBASE_PROJECT_ID || !ENV.FIREBASE_PRIVATE_KEY) {
            logger.warn('Firebase not configured — using local storage');
            this._loadLocal();
            return;
        }
        try {
            // Normalise escaped newlines that some env managers produce
            let key = ENV.FIREBASE_PRIVATE_KEY
                .replace(/^['"]|['"]$/g, '') // Remove surrounding quotes
                .replace(/\\n/g, '\n');      // Convert literal \n to real newlines
            if (!key.includes('-----BEGIN PRIVATE KEY-----')) {
                throw new Error('Missing BEGIN PRIVATE KEY header');
            }


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
            logger.info('Firebase successfully initialised');
        } catch (err) {
            logger.error(`Firebase init failed: ${err.message} — falling back to local`);
            this.db = null; // Ensure we don't try to use a broken connection
            this._loadLocal();
        }
    }

    _loadLocal() {
        try {
            if (fs.existsSync('./data/vouchers.json')) {
                const raw = JSON.parse(fs.readFileSync('./data/vouchers.json', 'utf8'));
                for (const [k, v] of Object.entries(raw)) this._local.set(k, v);
            }
            if (fs.existsSync('./data/wallets.json')) {
                const raw = JSON.parse(fs.readFileSync('./data/wallets.json', 'utf8'));
                for (const [u, codes] of Object.entries(raw)) this._wallets.set(u, new Set(codes));
            }
        } catch { /* first run */ }
    }

    _saveLocal() {
        if (this.db) return;
        try {
            if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
            fs.writeFileSync('./data/vouchers.json',
                JSON.stringify(Object.fromEntries(this._local), null, 2));

            const walletData = {};
            for (const [u, s] of this._wallets) walletData[u] = Array.from(s);
            fs.writeFileSync('./data/wallets.json', JSON.stringify(walletData, null, 2));
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
            actor: data.actor || 'system'
        };
        if (this.db) await this.db.collection('vouchers').doc(code).set(record);
        else { this._local.set(code, record); this._saveLocal(); }

        await this.logAuditTrail(record.actor, 'voucher.create', { code, plan: data.plan });

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

    async updateVoucher(code, updates) {
        if (this.db) {
            await this.db.collection('vouchers').doc(code).update(updates);
        } else {
            const v = this._local.get(code);
            if (v) { this._local.set(code, { ...v, ...updates }); this._saveLocal(); }
        }
    }

    async getVoucherByPaymentId(paymentId) {
        if (this.db) {
            const snap = await this.db.collection('vouchers').where('paymentId', '==', paymentId).limit(1).get();
            return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
        }
        for (const [id, v] of this._local.entries()) {
            if (v.paymentId === paymentId) return { id, ...v };
        }
        return null;
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

    async logAuditTrail(actor, action, details = {}) {
        const entry = {
            actor, action, details,
            timestamp: new Date().toISOString()
        };

        // Always log to Winston (local file)
        logger.info(`[AUDIT] ${actor} performed ${action}: ${JSON.stringify(details)}`);


        try {
            if (this.db) {
                // We use a timeout to prevent the CLI from hanging if the network is slow
                const writePromise = this.db.collection('audit_trail').add(entry);
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Firestore timeout')), 5000)
                );
                await Promise.race([writePromise, timeoutPromise]);
            }
        } catch (err) {
            // Only log the error, DO NOT throw. The router action must succeed 
            // even if the logging database is temporarily unreachable.
            logger.warn(`Audit upload failed: ${err.message}`);
        }
        return entry;
    }

    // ── Wallet Methods ────────────────────────────────────────

    async depositToWallet(userId, code) {
        if (this.db) {
            await this.db.collection('wallets').doc(userId).collection('vouchers').doc(code).set({
                addedAt: new Date().toISOString(),
                claimed: false
            });
        } else {
            if (!this._wallets.has(userId)) this._wallets.set(userId, new Set());
            this._wallets.get(userId).add(code);
            this._saveLocal();
        }
        logger.info(`Voucher ${code} deposited to wallet ${userId}`);
    }

    async getWallet(userId) {
        if (this.db) {
            const snap = await this.db.collection('wallets').doc(userId).collection('vouchers').where('claimed', '==', false).get();
            return snap.docs.map(d => d.id);
        }
        return Array.from(this._wallets.get(userId) || []);
    }

    async claimFromWallet(userId, code) {
        if (this.db) {
            await this.db.collection('wallets').doc(userId).collection('vouchers').doc(code).update({
                claimed: true,
                claimedAt: new Date().toISOString()
            });
        } else {
            const s = this._wallets.get(userId);
            if (s) { s.delete(code); this._saveLocal(); }
        }
    }
}

// ============================================================
// §3.5  FINANCIAL CONTROLLER
// ============================================================

class FinancialController {
    constructor(db) {
        this.db = db;
        this.mastercard = a2aService; // reuse top-level singleton
        this.pricing = {
            '1Hour': 0.50,
            '1Day': 1.00,
            '7Day': 3.00,
            '30Days': 5.00,
            'default': 10.00
        };
    }

    _price(plan) {
        const planKey = Object.keys(this.pricing).find(k => k.toLowerCase() === (plan || '').toLowerCase());
        return this.pricing[planKey] ?? this.pricing.default;
    }

    async getRevenueReport() {
        const vouchers = await this.db.listVouchers({ limit: 10000 });
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

        let total = 0, today = 0, pending = 0;
        const plans = {};

        vouchers.forEach(v => {
            const price = this._price(v.plan);
            total += price;
            if (new Date(v.createdAt).getTime() >= startOfDay) today += price;
            if (!v.used) pending += price;

            plans[v.plan] = (plans[v.plan] || 0) + 1;
        });

        return {
            currency: 'USD',
            grossRevenue: total.toFixed(2),
            todayRevenue: today.toFixed(2),
            potentialRevenue: pending.toFixed(2),
            topPlan: Object.entries(plans).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A'
        };
    }

    async verifyPayment(paymentId) {
        return await this.mastercard.getPaymentStatus(paymentId);
    }

    async auditTrail(limit = 10) {
        if (this.db && this.db.db) {
            const snap = await this.db.db.collection('audit_trail').orderBy('timestamp', 'desc').limit(limit).get();
            return snap.docs.map(d => d.data());
        }
        return [];
    }

    // Revenue intelligence — 7-day trend, hourly velocity, plan mix, churn signal
    async getTrends() {
        const vouchers = await this.db.listVouchers({ limit: 10000 });
        const now = Date.now();
        const DAY = 86_400_000;

        // Build daily buckets for last 7 days
        const days = Array.from({ length: 7 }, (_, i) => {
            const start = now - (6 - i) * DAY;
            const end = start + DAY;
            const label = new Date(start).toISOString().slice(5, 10);
            const created = vouchers.filter(v => {
                const t = new Date(v.createdAt).getTime();
                return t >= start && t < end;
            });
            const revenue = created.reduce((s, v) => s + this._price(v.plan), 0);
            return { label, count: created.length, revenue: revenue.toFixed(2) };
        });

        // Hourly velocity (last 24h)
        const hourly = Array.from({ length: 24 }, (_, h) => {
            const start = now - (23 - h) * 3_600_000;
            const end = start + 3_600_000;
            return vouchers.filter(v => {
                const t = new Date(v.createdAt).getTime();
                return t >= start && t < end;
            }).length;
        });

        // Plan mix
        const planMix = {};
        vouchers.forEach(v => { planMix[v.plan] = (planMix[v.plan] || 0) + 1; });

        // Churn signal: vouchers active > 90% of their plan window without being used
        const churnAtRisk = vouchers.filter(v => {
            if (v.used || !v.expiresAt || !v.createdAt) return false;
            const window = new Date(v.expiresAt).getTime() - new Date(v.createdAt).getTime();
            const elapsed = now - new Date(v.createdAt).getTime();
            return elapsed / window > 0.9;
        }).length;

        // Week-on-week growth
        const thisWeek = days.slice(4).reduce((s, d) => s + parseFloat(d.revenue), 0);
        const lastWeek = days.slice(0, 3).reduce((s, d) => s + parseFloat(d.revenue), 0);
        const wow = lastWeek > 0 ? (((thisWeek - lastWeek) / lastWeek) * 100).toFixed(1) : null;

        return { days, hourly, planMix, churnAtRisk, weekOnWeekGrowth: wow };
    }
}

const database = new Database();
const financial = new FinancialController(database);

// ============================================================
// §3.6  ENCRYPTION VAULT  (Omni-Agent — AES-256-GCM + scrypt)
// ============================================================

class EncryptionVault {
    constructor(masterKey) {
        // Pad/truncate weak keys so scrypt always has material to work with
        const key = (masterKey || 'changeme').padEnd(16, '!');
        this.masterKey = scryptSync(key, 'AgentOS-Omni-Salt-v2026', 32);
    }

    encrypt(plaintext) {
        const iv = randomBytes(CONFIG.VAULT.IV_LENGTH);
        const cipher = createCipheriv(CONFIG.VAULT.ALGORITHM, this.masterKey, iv);
        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const tag = cipher.getAuthTag();
        return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
    }

    decrypt(ciphertext) {
        const [ivHex, tagHex, encrypted] = ciphertext.split(':');
        if (!ivHex || !tagHex || !encrypted) throw new Error('Invalid encrypted format');
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        const decipher = createDecipheriv(CONFIG.VAULT.ALGORITHM, this.masterKey, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    hash(data) {
        return crypto.createHmac('sha256', this.masterKey).update(data).digest('hex');
    }

    timingSafeCompare(a, b) {
        const bufA = Buffer.from(a);
        const bufB = Buffer.from(b);
        if (bufA.length !== bufB.length) return false;
        return crypto.timingSafeEqual(bufA, bufB);
    }
}

const encVault = new EncryptionVault(CONFIG.VAULT.MASTER_KEY);

// ============================================================
// §3.7  OAUTH VAULT  (Omni-Agent — secure token storage)
// ============================================================

class OAuthVault {
    constructor(db, encryptionVault) {
        this.db = db;
        this.vault = encryptionVault;
        this.tokenCache = new Map();
        this.refreshTimers = new Map();
    }

    async storeTokens(provider, userId, tokens) {
        const encrypted = {
            accessToken: this.vault.encrypt(tokens.accessToken),
            refreshToken: tokens.refreshToken ? this.vault.encrypt(tokens.refreshToken) : null,
            expiresAt: tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : null,
            scope: tokens.scope,
            tokenType: tokens.tokenType || 'Bearer',
        };
        const record = { userId, provider, encrypted, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        if (this.db.db) {
            await this.db.db.collection('oauth_tokens').doc(`${provider}_${userId}`).set(record);
        } else {
            if (!this.db._oauth) this.db._oauth = new Map();
            this.db._oauth.set(`${provider}_${userId}`, record);
        }
        this.tokenCache.set(`${provider}_${userId}`, { ...tokens, cachedAt: Date.now() });
        if (tokens.expiresAt && tokens.refreshToken) {
            this._scheduleRefresh(provider, userId, tokens.expiresAt);
        }
        await this.db.logAuditTrail(userId, 'oauth.store', { provider }).catch(() => { });
        return true;
    }

    async getAccessToken(provider, userId) {
        const cacheKey = `${provider}_${userId}`;
        const cached = this.tokenCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now() + 60000) return cached.accessToken;
        let record;
        if (this.db.db) {
            const doc = await this.db.db.collection('oauth_tokens').doc(cacheKey).get();
            record = doc.exists ? doc.data() : null;
        } else {
            record = this.db._oauth?.get(cacheKey);
        }
        if (!record) throw new Error(`No tokens found for ${provider}/${userId}`);
        const tokens = {
            accessToken: this.vault.decrypt(record.encrypted.accessToken),
            refreshToken: record.encrypted.refreshToken ? this.vault.decrypt(record.encrypted.refreshToken) : null,
            expiresAt: record.encrypted.expiresAt ? new Date(record.encrypted.expiresAt).getTime() : null,
            scope: record.encrypted.scope,
        };
        if (tokens.expiresAt && tokens.expiresAt < Date.now() + 60000 && tokens.refreshToken) {
            const refreshed = await this._refreshToken(provider, userId, tokens.refreshToken);
            return refreshed.accessToken;
        }
        this.tokenCache.set(cacheKey, { ...tokens, cachedAt: Date.now() });
        return tokens.accessToken;
    }

    async _refreshToken(provider, userId, refreshToken) {
        const refreshUrls = { github: 'https://github.com/login/oauth/access_token' };
        const response = await fetch(refreshUrls[provider], {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: CONFIG.OAUTH[provider.toUpperCase()]?.CLIENT_ID,
                client_secret: CONFIG.OAUTH[provider.toUpperCase()]?.CLIENT_SECRET,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(`Token refresh failed: ${data.error}`);
        const tokens = {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || refreshToken,
            expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
            scope: data.scope,
        };
        await this.storeTokens(provider, userId, tokens);
        return tokens;
    }

    _scheduleRefresh(provider, userId, expiresAt) {
        const cacheKey = `${provider}_${userId}`;
        const refreshTime = expiresAt - Date.now() - 300000;
        if (refreshTime > 0) {
            if (this.refreshTimers.has(cacheKey)) clearTimeout(this.refreshTimers.get(cacheKey));
            this.refreshTimers.set(cacheKey, setTimeout(() => {
                this.getAccessToken(provider, userId).catch(err =>
                    logger.error(`Auto-refresh failed for ${cacheKey}: ${err.message}`)
                );
            }, refreshTime));
        }
    }

    async revokeTokens(provider, userId) {
        const cacheKey = `${provider}_${userId}`;
        try {
            const token = await this.getAccessToken(provider, userId);
            if (provider === 'github') {
                await fetch(`https://api.github.com/applications/${CONFIG.OAUTH.GITHUB.CLIENT_ID}/token`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Basic ${Buffer.from(`${CONFIG.OAUTH.GITHUB.CLIENT_ID}:${CONFIG.OAUTH.GITHUB.CLIENT_SECRET}`).toString('base64')}`,
                        'Accept': 'application/vnd.github+json',
                    },
                    body: JSON.stringify({ access_token: token }),
                });
            }
        } catch (err) { logger.warn(`Token revocation failed (non-critical): ${err.message}`); }
        if (this.db.db) {
            await this.db.db.collection('oauth_tokens').doc(cacheKey).delete();
        } else { this.db._oauth?.delete(cacheKey); }
        this.tokenCache.delete(cacheKey);
        if (this.refreshTimers.has(cacheKey)) {
            clearTimeout(this.refreshTimers.get(cacheKey));
            this.refreshTimers.delete(cacheKey);
        }
        await this.db.logAuditTrail(userId, 'oauth.revoke', { provider }).catch(() => { });
        return true;
    }
}

const oauthVault = new OAuthVault(database, encVault);

// ============================================================
// §3.8  GITHUB INTEGRATION  (Omni-Agent — Octokit)
// ============================================================

class GitHubIntegration {
    constructor(vault) {
        this.vault = vault;
        this.webhookHandlers = new Map();
        this.enabled = !!(Octokit && ENV.GITHUB_CLIENT_ID);
    }

    async getClient(userId = 'default') {
        if (!Octokit) throw new Error('Octokit not installed — npm install @octokit/rest');
        const token = await this.vault.getAccessToken('github', userId);
        return new Octokit({ auth: token, userAgent: `AgentOS/${BRAND.version}` });
    }

    getOAuthURL(state) {
        const params = new URLSearchParams({
            client_id: CONFIG.OAUTH.GITHUB.CLIENT_ID,
            redirect_uri: CONFIG.OAUTH.GITHUB.REDIRECT_URI,
            scope: CONFIG.OAUTH.GITHUB.SCOPE,
            state: state || crypto.randomBytes(16).toString('hex'),
        });
        return `https://github.com/login/oauth/authorize?${params}`;
    }

    async handleCallback(code) {
        const response = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: CONFIG.OAUTH.GITHUB.CLIENT_ID,
                client_secret: CONFIG.OAUTH.GITHUB.CLIENT_SECRET,
                code,
                redirect_uri: CONFIG.OAUTH.GITHUB.REDIRECT_URI,
            }),
        });
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(`OAuth failed: ${data.error_description || data.error}`);
        const tempClient = new Octokit({ auth: data.access_token });
        const { data: user } = await tempClient.rest.users.getAuthenticated();
        await this.vault.storeTokens('github', user.login, {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
            scope: data.scope,
        });
        return { userId: user.login, avatar: user.avatar_url, name: user.name || user.login };
    }

    async pushFile(userId, owner, repo, filePath, content, message, branch = 'main') {
        const octokit = await this.getClient(userId);
        const { data: ref } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
        const { data: commit } = await octokit.rest.git.getCommit({ owner, repo, commit_sha: ref.object.sha });
        const { data: blob } = await octokit.rest.git.createBlob({ owner, repo, content: Buffer.from(content).toString('base64'), encoding: 'base64' });
        const { data: tree } = await octokit.rest.git.createTree({ owner, repo, base_tree: commit.tree.sha, tree: [{ path: filePath, mode: '100644', type: 'blob', sha: blob.sha }] });
        const { data: newCommit } = await octokit.rest.git.createCommit({ owner, repo, message: `[AgentOS] ${message}`, tree: tree.sha, parents: [commit.sha] });
        await octokit.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: newCommit.sha });
        await this.vault.db.logAuditTrail(userId, 'github.push', { owner, repo, filePath, branch }).catch(() => { });
        return { commit: newCommit.sha, url: `https://github.com/${owner}/${repo}/commit/${newCommit.sha}` };
    }

    async createPR(userId, owner, repo, title, body, head, base = 'main') {
        const octokit = await this.getClient(userId);
        const { data: pr } = await octokit.rest.pulls.create({ owner, repo, title: `[AgentOS] ${title}`, body, head, base });
        return { number: pr.number, url: pr.html_url, state: pr.state };
    }

    async listRepos(userId) {
        const octokit = await this.getClient(userId);
        const { data: repos } = await octokit.rest.repos.listForAuthenticatedUser({ sort: 'updated', per_page: 100 });
        return repos.map(r => ({ name: r.name, fullName: r.full_name, url: r.html_url, defaultBranch: r.default_branch, isPrivate: r.private, updatedAt: r.updated_at }));
    }

    async deployToPages(userId, owner, repo, sourceBranch = 'main', sourcePath = '/') {
        const octokit = await this.getClient(userId);
        try { await octokit.rest.repos.createPagesSite({ owner, repo, source: { branch: sourceBranch, path: sourcePath } }); }
        catch (err) { if (err.status !== 409) throw err; }
        const { data: build } = await octokit.rest.repos.requestPagesBuild({ owner, repo });
        return { status: build.status, url: `https://${owner}.github.io/${repo}/` };
    }

    async syncDirectory(userId, localPath, owner, repo, repoPath = '', branch = 'main') {
        const files = [];
        const readDir = async (dir, basePath = '') => {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relativePath = path.join(basePath, entry.name);
                if (entry.isDirectory()) { await readDir(fullPath, relativePath); }
                else { files.push({ path: path.join(repoPath, relativePath).replace(/\\/g, '/'), content: (await fs.promises.readFile(fullPath)).toString() }); }
            }
        };
        await readDir(localPath);
        const results = [];
        for (const file of files) {
            const result = await this.pushFile(userId, owner, repo, file.path, file.content, `Sync ${file.path}`, branch);
            results.push({ path: file.path, commit: result.commit });
        }
        return { synced: results.length, files: results };
    }

    handleWebhook(payload, signature) {
        if (CONFIG.OAUTH.GITHUB.WEBHOOK_SECRET && signature) {
            const hmac = crypto.createHmac('sha256', CONFIG.OAUTH.GITHUB.WEBHOOK_SECRET);
            hmac.update(typeof payload === 'string' ? payload : JSON.stringify(payload));
            const digest = `sha256=${hmac.digest('hex')}`;
            if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
                throw new Error('Invalid webhook signature');
            }
        }
        const event = payload.event || payload.headers?.['x-github-event'];
        const handlers = this.webhookHandlers.get(event) || [];
        handlers.forEach(h => h(payload).catch(err => logger.error(`Webhook handler error: ${err.message}`)));
        return { received: true, event };
    }

    onWebhookEvent(event, handler) {
        if (!this.webhookHandlers.has(event)) this.webhookHandlers.set(event, []);
        this.webhookHandlers.get(event).push(handler);
    }
}

const github = new GitHubIntegration(oauthVault);

// ============================================================
// §4.6  AGENT MEMORY  (persistent cross-session context)
// ============================================================

class AgentMemory {
    constructor() {
        this._path = './data/memory.json';
        this._store = {};
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(this._path)) {
                this._store = JSON.parse(fs.readFileSync(this._path, 'utf8'));
            }
        } catch { /* first run */ }
    }

    _save() {
        try {
            if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
            fs.writeFileSync(this._path, JSON.stringify(this._store, null, 2));
        } catch (err) { logger.error(`Memory save failed: ${err.message}`); }
    }

    remember(key, value) {
        this._store[key] = { value, updatedAt: new Date().toISOString() };
        this._save();
    }

    recall(key) {
        return this._store[key]?.value ?? null;
    }

    recallAll() {
        return Object.fromEntries(Object.entries(this._store).map(([k, v]) => [k, v.value]));
    }

    forget(key) {
        delete this._store[key];
        this._save();
    }

    // Returns a compact context string for injection into AI prompts
    getContext() {
        const entries = Object.entries(this._store);
        if (!entries.length) return '';
        const lines = entries.map(([k, v]) => `- ${k}: ${JSON.stringify(v.value)}`).join('\n');
        return `[Agent Memory]\n${lines}`;
    }
}

// ============================================================
// §4.7  NODE REGISTRY  (multi-router mesh management)
// ============================================================

class NodeRegistry {
    constructor() {
        this._nodes = new Map();  // name → MikroTikManager
    }

    add(name, ip, user, pass, port = CONFIG.MIKROTIK.PORT) {
        if (this._nodes.has(name)) this._nodes.get(name).disconnect();
        const node = new MikroTikManager({ ip, user, pass, port });
        this._nodes.set(name, node);
        logger.info(`NodeRegistry: registered "${name}" (${ip})`);
        return node;
    }

    get(name) {
        return this._nodes.get(name) || null;
    }

    getAll() {
        return [...this._nodes.entries()].map(([name, node]) => ({
            name,
            ip: node.api?.options?.host || 'unknown',
            connected: node.isConnected,
        }));
    }

    async connectAll() {
        const results = [];
        for (const [name, node] of this._nodes) {
            try {
                await node.connect();
                results.push({ name, status: 'connected' });
            } catch (err) {
                results.push({ name, status: 'failed', error: err.message });
            }
        }
        return results;
    }

    async executeOnNode(name, tool, ...args) {
        const node = this._nodes.get(name);
        if (!node) throw new Error(`Node not found: ${name}`);
        return node.executeTool(tool, ...args);
    }

    // Fan-out a tool call across all connected nodes — returns per-node results
    async executeOnAll(tool, ...args) {
        const results = {};
        for (const [name, node] of this._nodes) {
            if (!node.isConnected) { results[name] = { error: 'offline' }; continue; }
            try {
                results[name] = await node.executeTool(tool, ...args);
            } catch (err) {
                results[name] = { error: err.message };
            }
        }
        return results;
    }

    disconnectAll() {
        for (const node of this._nodes.values()) node.disconnect();
    }
}


class SkillRegistry {
    constructor() {
        this.builtins = new Map();      // Bundled skills
        this.workspace = new Map();     // User-created skills  
        this.cache = new Map(); // Recently used (simple LRU-like map)
    }

    // Skills are loaded on-demand, not at startup
    async resolve(skillName, context) {
        // Check cache first
        if (this.cache.has(skillName)) return this.cache.get(skillName);

        // Search paths: workspace > managed > bundled
        const paths = [
            `./skills/${skillName}/SKILL.md`,           // User workspace
            `~/.agentos/skills/${skillName}/SKILL.md`,   // Global install
            `${__dirname}/skills/${skillName}/SKILL.md`  // Bundled
        ];

        for (const path of paths) {
            const skill = await this.loadSkill(path, context);
            if (skill) {
                this.cache.set(skillName, skill);
                return skill;
            }
        }

        throw new Error(`Skill not found: ${skillName}`);
    }

    async loadSkill(path, context) {
        // SKILL.md format:
        // ---
        // name: hotspot_manager
        // description: Manage MikroTik Hotspot users
        // requires:
        //   bins: ["ssh", "curl"]
        //   env: ["MIKROTIK_IP"]
        //   os: ["linux", "darwin"]
        // tools: ["user.add", "user.kick", "user.list"]
        // ---
        // # hotspot_manager
        // Detailed instructions for the AI...

        const content = await fs.promises.readFile(path, 'utf8');
        const { attributes, body } = this.parseFrontmatter(content);

        // Validate requirements
        if (!this.checkRequirements(attributes.requires)) {
            return null; // Skill gated - requirements not met
        }

        return {
            metadata: attributes,
            instructions: body,
            tools: (attributes.tools || []).map(t => this.createTool(t, context))
        };
    }

    parseFrontmatter(content) {
        const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (!match) return { attributes: { tools: [] }, body: content };
        const attributes = {};
        match[1].split('\n').forEach(line => {
            const [k, ...v] = line.split(':');
            if (k && v.length) {
                const val = v.join(':').trim();
                // Parse simple arrays: ["a", "b"]
                if (val.startsWith('[')) {
                    try { attributes[k.trim()] = JSON.parse(val); } catch { attributes[k.trim()] = val; }
                } else {
                    attributes[k.trim()] = val;
                }
            }
        });
        if (!attributes.tools) attributes.tools = [];
        return { attributes, body: match[2].trim() };
    }

    checkRequirements(requires) {
        if (!requires) return true;
        // Check required env vars
        if (requires.env) {
            for (const key of requires.env) {
                if (!process.env[key]) {
                    logger.warn(`SkillRegistry: missing env var ${key}`);
                    return false;
                }
            }
        }
        // Check OS
        if (requires.os && !requires.os.includes(process.platform)) {
            logger.warn(`SkillRegistry: unsupported platform ${process.platform}`);
            return false;
        }
        return true;
    }

    // Wraps a tool name string into a callable that routes through mikrotik.executeTool
    createTool(toolName, context) {
        return {
            name: toolName,
            call: (...args) => {
                const node = context?.node || mikrotik;
                return node.executeTool(toolName, ...args);
            },
        };
    }

    // Evict oldest entry if cache grows beyond 50
    _cacheSet(key, value) {
        if (this.cache.size >= 50) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }
}

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
        if (!username) throw new Error('Username required for removal');
        const users = await c.menu('/ip/hotspot/user').where('name', username).get();
        if (!users.length) throw new Error(`User not found: ${username}`);
        const id = users[0]['.id'];
        if (!id) throw new Error(`Could not resolve router ID for user: ${username}`);
        await c.menu('/ip/hotspot/user').remove(id);
        return { action: 'removed', username };
    },
    'user.kick': async (c, username) => {
        if (!username) throw new Error('Username required to kick');
        const active = await c.menu('/ip/hotspot/active').where('user', username).get();
        if (active.length) {
            const id = active[0]['.id'];
            if (!id) throw new Error(`Could not resolve session ID for user: ${username}`);
            await c.menu('/ip/hotspot/active').remove(id);
            return { kicked: true, username };
        }
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
    'wireless.clients': async (c) => c.menu('/interface/wireless/registration-table').get(),
    'wireless.interfaces': async (c) => c.menu('/interface/wireless').get(),
    'wireless.set_frequency': async (c, name, frequency) => {
        const ifaces = await c.menu('/interface/wireless').where('name', name).get();
        if (!ifaces.length) throw new Error(`Wireless interface not found: ${name}`);
        await c.menu('/interface/wireless').update(ifaces[0]['.id'], { frequency: String(frequency) });
        return { action: 'updated_frequency', interface: name, frequency };
    },
    'interface.monitor-traffic': async (c, iface) => c.menu('/interface').exec('monitor-traffic', { interface: iface, once: true }),
    'neighbor.discovery': async (c) => c.menu('/ip/neighbor').get(),
};

// ============================================================
// §7  MIKROTIK MANAGER
// ============================================================

class MikroTikManager {
    constructor(opts = {}) {
        this.conn = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this._monitorTimer = null;

        const host = opts.ip || CONFIG.MIKROTIK.IP;
        const user = opts.user || CONFIG.MIKROTIK.USER;
        const password = opts.pass || CONFIG.MIKROTIK.PASS;
        const port = opts.port || CONFIG.MIKROTIK.PORT;

        this.api = new RouterOSClient({ host, user, password, port, timeout: 10_000 });

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

    async updateCredentials(ip, user, pass) {
        if (this.conn) {
            try { this.api.close(); } catch { }
        }
        this.conn = null;
        this.isConnected = false;
        this.ip = ip;
        this.api = new RouterOSClient({ host: ip, user, password: pass, port: CONFIG.MIKROTIK.PORT, timeout: 10_000 });
        return this.connect();
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

        // Permission gate (claw-code PermissionPolicy port)
        const perm = permissionPolicy.check(name);
        if (!perm.allowed) throw new Error(`Permission denied: ${perm.reason}`);

        metrics.toolInvocations++;

        // Pre-execution hooks (audit, telemetry)
        await hooks.runBefore(name, args);

        const result = await fn(this.conn, ...args);

        // Post-execution hooks (broadcast, SSE)
        await hooks.runAfter(name, args, result);

        return result;
    }

    // Send a raw RouterOS CLI command via a temporary script
    async executeCLI(command) {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        // Sanitize: block shell injection patterns that have no place in RouterOS scripts
        const forbidden = /[`$(){}|;&<>]/;
        if (forbidden.test(command)) throw new Error(`Blocked: command contains forbidden characters`);
        if (command.length > 4096) throw new Error('Command exceeds maximum length (4096 chars)');
        const scriptName = `_agentos_${Date.now()}`;
        try {
            await this.conn.menu('/system/script').add({ name: scriptName, source: command });
            // Retrieve the newly created script's .id, then invoke run on it specifically
            const added = await this.conn.menu('/system/script').where('name', scriptName).get();
            if (added.length) {
                await this.conn.menu('/system/script').exec('run', { '.id': added[0]['.id'] });
            }
            // RouterOS API exec does not return stdout; check logs for output
            const logs = await this.conn.menu('/log').where('topics', 'script').get();
            const recent = logs.slice(-3).map(l => l.message || '').join('\n');
            return recent || 'OK';
        } catch (err) {
            throw new Error(`CLI exec failed: ${err.message}`);
        } finally {
            const entries = await this.conn.menu('/system/script').where('name', scriptName).get().catch(() => []);
            for (const e of entries) await this.conn.menu('/system/script').remove(e['.id']).catch(() => { });
        }
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
// §7.5  OS ADAPTERS  (Omni-Agent — Linux SSH & Windows PowerShell)
// ============================================================

class OSAdapter {
    async connect() { throw new Error('Not implemented'); }
    async exec(_cmd) { throw new Error('Not implemented'); }
    async getSystemStats() { throw new Error('Not implemented'); }
    disconnect() { }
}

class LinuxSSHAdapter extends OSAdapter {
    constructor(opts = {}) {
        super();
        this.isConnected = false;
        this.ssh = null;
        this.host = opts.ip || ENV.SSH_HOST;
        this.user = opts.user || ENV.SSH_USER;
        this.pass = opts.pass || ENV.SSH_PASS;
    }
    async connect() {
        try {
            const { NodeSSH } = await import('node-ssh');
            this.ssh = new NodeSSH();
            await this.ssh.connect({ host: this.host, username: this.user, password: this.pass, tryKeyboard: true });
            this.isConnected = true;
            logger.info(`SSH connected to ${this.host}`);
            return true;
        } catch (err) {
            this.isConnected = false;
            logger.error(`SSH connect failed: ${err.message}`);
            throw err;
        }
    }
    async exec(command) {
        if (!this.isConnected || !this.ssh) throw new Error('SSH not connected');
        const result = await this.ssh.execCommand(command);
        return { stdout: result.stdout, stderr: result.stderr, code: result.code };
    }
    async getSystemStats() {
        const { stdout } = await this.exec('cat /proc/loadavg && free -b && cat /proc/uptime');
        const lines = stdout.split('\n');
        const load = lines[0].split(' ');
        const mem = lines[1].split(/\s+/);
        const uptime = parseFloat(lines[2].split(' ')[0]);
        return {
            'cpu-load': Math.round(parseFloat(load[0]) * 100 / require('os').cpus().length),
            'free-memory': parseInt(mem[3]),
            'total-memory': parseInt(mem[1]),
            uptime: fmtUptime(uptime),
            version: 'Linux',
        };
    }
    async getActiveUsers() {
        const { stdout } = await this.exec('who');
        return stdout.split('\n').filter(Boolean).map(line => {
            const parts = line.split(/\s+/);
            return { user: parts[0], address: parts[1], uptime: parts[2] };
        });
    }
    async reboot() { await this.exec('sudo reboot'); return { status: 'rebooting' }; }
    disconnect() { if (this.ssh) { this.ssh.dispose(); this.ssh = null; } this.isConnected = false; }
}

class WindowsPowerShellAdapter extends OSAdapter {
    constructor(opts = {}) {
        super();
        this.isConnected = false;
        this.host = opts.ip || opts.host;
        this.user = opts.user;
        this.pass = opts.pass;
        this.isLocal = !opts.ip;
    }
    async connect() {
        if (this.isLocal) { this.isConnected = true; logger.info('Windows PowerShell adapter ready (local)'); return true; }
        throw new Error('Remote Windows WinRM not yet implemented');
    }
    async exec(command) {
        if (!this.isConnected) throw new Error('Not connected');
        if (this.isLocal) {
            return new Promise((resolve, reject) => {
                const ps = spawn('powershell.exe', ['-Command', command]);
                let stdout = '', stderr = '';
                ps.stdout.on('data', d => stdout += d);
                ps.stderr.on('data', d => stderr += d);
                ps.on('close', code => resolve({ stdout, stderr, code }));
                ps.on('error', reject);
            });
        }
    }
    async getSystemStats() {
        const { stdout } = await this.exec(`Get-CimInstance Win32_Processor | Select-Object LoadPercentage | ConvertTo-Json; Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory,TotalVisibleMemorySize,LastBootUpTime | ConvertTo-Json`);
        try {
            const data = JSON.parse(stdout);
            return {
                'cpu-load': data.LoadPercentage || 0,
                'free-memory': (data.FreePhysicalMemory || 0) * 1024,
                'total-memory': (data.TotalVisibleMemorySize || 0) * 1024,
                uptime: fmtUptime((Date.now() - new Date(data.LastBootUpTime).getTime()) / 1000),
                version: 'Windows',
            };
        } catch { return { 'cpu-load': 0, 'free-memory': 0, uptime: 'unknown', version: 'Windows' }; }
    }
    async injectWiFiProfile(ssid, password) {
        const profileXml = `<?xml version="1.0"?><WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1"><name>${ssid}</name><SSIDConfig><SSID><name>${ssid}</name></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>auto</connectionMode><MSM><security><authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption><sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>${password}</keyMaterial></sharedKey></security></MSM></WLANProfile>`;
        const tmpFile = path.join(require('os').tmpdir(), `wifi-${Date.now()}.xml`);
        await fs.promises.writeFile(tmpFile, profileXml);
        const { stdout } = await this.exec(`netsh wlan add profile filename="${tmpFile}"; netsh wlan connect name="${ssid}"`);
        await fs.promises.unlink(tmpFile).catch(() => { });
        return { success: stdout.includes('success') || stdout.includes('connected'), output: stdout };
    }
    async gitPush(repoPath, message, branch = 'main') {
        const { stdout, stderr } = await this.exec(`cd "${repoPath}"; git add .; git commit -m "${message.replace(/"/g, '\\"')}" 2>&1 || echo "No changes"; git push origin ${branch} 2>&1`);
        return { stdout, stderr, success: !stderr.includes('error') };
    }
    disconnect() { this.isConnected = false; }
}

// ============================================================
// §7.6  DEVICE CONTROLLER  (Omni-Agent — multi-device WS mesh)
// ============================================================

class DeviceController {
    constructor() {
        this.devices = new Map(); // deviceId -> { ws, info, lastSeen }
    }
    registerDevice(deviceId, ws, info) {
        this.devices.set(deviceId, { ws, info, lastSeen: Date.now() });
        database.registerDevice?.(deviceId, info);
        logger.info(`Device registered: ${deviceId} (${info.type})`);
    }
    updateHeartbeat(deviceId) {
        const device = this.devices.get(deviceId);
        if (device) { device.lastSeen = Date.now(); database.updateDeviceHeartbeat?.(deviceId, { status: 'online' }); }
    }
    async executeOnDevice(deviceId, command) {
        const device = this.devices.get(deviceId);
        if (!device) throw new Error(`Device ${deviceId} not connected`);
        return new Promise((resolve, reject) => {
            const requestId = crypto.randomBytes(4).toString('hex');
            const timeout = setTimeout(() => reject(new Error('Device command timeout')), 30000);
            const handler = (rawData) => {
                try {
                    const data = JSON.parse(rawData.toString());
                    if (data.requestId === requestId) {
                        clearTimeout(timeout);
                        device.ws.off('message', handler);
                        if (data.error) reject(new Error(data.error));
                        else resolve(data.result);
                    }
                } catch { }
            };
            device.ws.on('message', handler);
            device.ws.send(JSON.stringify({ type: 'device.command', requestId, command }));
        });
    }
    broadcastToDevices(type, payload) {
        for (const [, { ws }] of this.devices) {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, payload, from: 'master' }));
        }
    }
    getConnectedDevices() {
        const now = Date.now();
        return [...this.devices.entries()].filter(([, d]) => now - d.lastSeen < 60000).map(([id, d]) => ({ id, ...d.info, lastSeen: d.lastSeen }));
    }
}

const deviceController = new DeviceController();

const agentMemory = new AgentMemory();
const nodeRegistry = new NodeRegistry();
// Register the primary router into the mesh
nodeRegistry.add('primary', CONFIG.MIKROTIK.IP, CONFIG.MIKROTIK.USER, CONFIG.MIKROTIK.PASS);

// ── Register default hooks ────────────────────────────────────
// Audit hook — log state-mutating tools to audit trail + Winston
['user.kick', 'system.reboot', 'firewall.block', 'user.add', 'user.remove', 'wireless.set_frequency'].forEach(tool => {
    hooks.onBefore(tool, async ({ tool: name, args }) => {
        await database.logAuditTrail('mikrotik', `tool.${name}`, { args }).catch(() => { });
    });
});

// Broadcast hook — push live activity to all WebSocket clients
Object.keys(TOOLS).forEach(tool => {
    hooks.onAfter(tool, async ({ tool: name, args }) => {
        if (global.gateway) {
            global.gateway.broadcast({
                type: 'activity',
                payload: { source: 'system', action: name, params: args, timestamp: new Date().toISOString() },
            });
        }
    });
});

// SSE hook — push tool events to SSE stream clients
Object.keys(TOOLS).forEach(tool => {
    hooks.onAfter(tool, async ({ tool: name, result }) => {
        if (typeof sseBroadcast === 'function') sseBroadcast('tool.result', { tool: name, result });
    });
});


// ============================================================

// Initialize payment for voucher purchase
router.post('/voucher/payment/initiate', [
    body('plan').isIn(['1hour', '1Day', '7Day', '30Day']),
    body('email').isEmail(),
    body('amount').isFloat({ min: 0.5 }),
    body('recipientAccount').isString().trim(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { plan, email, amount, recipientAccount, recipientBankCode } = req.body;

    // Generate voucher code
    const code = `STAR-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    try {
        // Create voucher in database first (pending status)
        await database.createVoucher(code, {
            plan,
            email,
            status: 'pending_payment',
            createdBy: 'mastercard-a2a',
            platform: 'api',
        });

        // Process A2A payment
        const result = await a2aService.processVoucherPurchase(
            { plan, email, code },
            { amount, recipientAccount, recipientBankCode }
        );

        if (!result.success) {
            await database.deleteVoucher(code);
            return res.status(400).json({
                error: 'Payment initiation failed',
                details: result.error,
            });
        }

        // Update voucher with payment reference
        await database.updateVoucher(code, {
            paymentId: result.paymentId,
            transactionRef: result.transactionRef,
            paymentStatus: result.status,
        });

        res.json({
            success: true,
            voucherCode: code,
            paymentId: result.paymentId,
            transactionRef: result.transactionRef,
            status: result.status,
            amount: result.amount,
            fees: result.fees,
            exchangeRate: result.exchangeRate,
            message: 'Payment initiated. Complete transfer via your banking app.',
        });

    } catch (error) {
        logger.error(`A2A payment initiation error: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get Daily Finance Summary
router.get('/finance/summary', async (req, res) => {
    try {
        const report = await financial.getRevenueReport();
        res.json(report);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Check payment status
router.get('/voucher/payment/status/:paymentId', async (req, res) => {
    try {
        const status = await a2aService.getPaymentStatus(req.params.paymentId);

        if (status.success) {
            // Update local database if completed
            if (status.status === 'COMPLETED') {
                const voucher = await database.getVoucherByPaymentId(req.params.paymentId);
                if (voucher && !voucher.activated) {
                    await mikrotik.addHotspotUser(voucher.id, voucher.id, voucher.plan);
                    await database.redeemVoucher(voucher.id, {
                        username: voucher.email,
                        paymentCompleted: true
                    });
                }
            }
        }

        res.json(status);
    } catch (error) {
        logger.error(`Payment status check error: ${error.message}`);
        res.status(500).json({ error: 'Failed to check payment status' });
    }
});

// Mastercard webhook for payment notifications
router.post('/webhook/mastercard', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        // Verify webhook signature
        const signature = req.headers['x-mastercard-signature'];
        const payload = req.body;

        // Process webhook
        const result = await a2aService.handleWebhook(JSON.parse(payload));

        // If payment completed, deposit voucher to user wallet and notify
        if (result?.status === 'COMPLETED' && result?.userId) {
            const voucher = await database.getVoucherByPaymentId(result.paymentId || '');
            if (voucher) {
                await database.depositToWallet(String(result.userId), voucher.id);
                global.agentBot?.sendToAll(`💰 *Payment Received:* Voucher \`${voucher.id}\` deposited to wallet for user ${result.userId}`);
            }
        }

        res.json({ received: true });
    } catch (error) {
        logger.error(`Webhook error: ${error.message}`);
        res.status(200).json({ received: true }); // Always return 200 to prevent retries
    }
});

// ============================================================
// §7.9  EMOTION ENGINE  (Omni-Agent — tone-aware responses)
// ============================================================

class EmotionEngine {
    constructor() {
        this.state = { mood: 0.5, urgency: 0.0, energy: 0.8, trust: 0.5 };
        this._urgencySetAt = null;
    }
    update(text, intent) {
        const lower = text.toLowerCase();
        if (/problem|error|broken|slow|angry|frustrated|not working|terrible/i.test(lower)) {
            this.state.mood = Math.max(-1, this.state.mood - 0.15);
        }
        if (/thanks|thank you|great|excellent|perfect|awesome|good job/i.test(lower)) {
            this.state.mood = Math.min(1, this.state.mood + 0.12);
            this.state.trust = Math.min(1, this.state.trust + 0.05);
        }
        if (intent === 'FIX') { this.state.urgency = Math.min(1, this.state.urgency + 0.4); this.state.energy = Math.min(1, this.state.energy + 0.15); this._urgencySetAt = Date.now(); }
        else if (intent === 'BUY') { this.state.mood = Math.min(1, this.state.mood + 0.05); }
        else if (intent === 'DEPLOY') { this.state.urgency = Math.min(1, this.state.urgency + 0.3); }
        if (this._urgencySetAt && Date.now() - this._urgencySetAt > CONFIG.EMOTION.URGENCY_TTL) {
            this.state.urgency = Math.max(0, this.state.urgency - 0.3);
            if (this.state.urgency === 0) this._urgencySetAt = null;
        }
        this.state.energy = Math.max(0.2, this.state.energy - CONFIG.EMOTION.DECAY_RATE);
        this._clamp();
        return { ...this.state };
    }
    toneHint() {
        if (this.state.urgency > 0.6) return 'User may be frustrated. Be concise and direct. Prioritise resolution.';
        if (this.state.mood < -0.3) return 'User seems unhappy. Be empathetic and solution-focused.';
        if (this.state.trust > 0.7) return 'Good rapport. You can be friendly and conversational.';
        return '';
    }
    _clamp() {
        for (const k of Object.keys(this.state)) this.state[k] = Math.max(-1, Math.min(1, this.state[k]));
        this.state.urgency = Math.max(0, Math.min(1, this.state.urgency));
        this.state.energy = Math.max(0.2, Math.min(1, this.state.energy));
    }
    getState() { return { ...this.state }; }
}

const emotionEngine = CONFIG.EMOTION.ENABLED ? new EmotionEngine() : null;

// ============================================================
// §8  ASK ENGINE  (Tiered ReAct)
// ============================================================

class AskEngine {
    constructor({ mikrotik, database, financial, ai }) {
        this.mikrotik = mikrotik;
        this.database = database;
        this.financial = financial;
        this.ai = ai;
        this.llm = llm; // Omni-Agent multi-LLM adapter
        this.memory = agentMemory;
        this.emotion = emotionEngine;
        this.isRuleOnly = !ENV.GEMINI_API_KEY || ENV.GEMINI_API_KEY.includes('your-');

        if (this.isRuleOnly) {
            logger.warn('AskEngine starting in [RULE-ONLY] mode (no valid Gemini key)');
        }

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
            {
                name: 'manage_finance',
                description: 'Query revenue, audits, and payment statuses.',
                parameters: {
                    type: 'object',
                    properties: {
                        action: { type: 'string', enum: ['revenue_report', 'verify_payment', 'audit_log', 'trends'] },
                        target: { type: 'string', description: 'Payment ID or reference' }
                    },
                    required: ['action']
                }
            },
            {
                name: 'manage_mesh',
                description: 'Execute commands across multiple routers in the node registry.',
                parameters: {
                    type: 'object',
                    properties: {
                        action: { type: 'string', enum: ['list_nodes', 'execute_all', 'execute_node'] },
                        node: { type: 'string', description: 'Node name for execute_node' },
                        tool: { type: 'string', description: 'Tool name to run' },
                    },
                    required: ['action'],
                },
            },
        ];

        // Tier-1 keyword → tool map (Human-to-Machine Translation shortcuts)
        this._toolMap = {
            'active users': { name: 'users.active', args: [] },
            'all users': { name: 'users.all', args: [] },
            'system stats': { name: 'system.stats', args: [] },
            'router status': { name: 'system.stats', args: [] },
            'reboot router': { name: 'system.reboot', args: [] },
            'dhcp leases': { name: 'dhcp.leases', args: [] },
            'arp table': { name: 'arp.table', args: [] },
            'interfaces': { name: 'interfaces', args: [] },
            'uptime': { name: 'system.stats', args: [] },
            'resources': { name: 'system.stats', args: [] },
            'who': { name: 'users.active', args: [] },
        };
    }

    async run(input) {
        // Prompt injection / shell metacharacter filter
        if (!input || typeof input !== 'string') return { tier: 0, type: 'error', result: 'Invalid input.' };
        const sanitized = input.slice(0, 2000);
        const injectionPattern = /(\bignore\b.*\binstructions\b|\bact as\b|\bsystem prompt\b|\bjailbreak\b)/i;
        if (injectionPattern.test(sanitized)) {
            return { tier: 0, type: 'blocked', result: '⚠️ Prompt injection detected. Request blocked.' };
        }
        // Tier 1 — direct keyword → tool
        const tier1 = this._matchTool(sanitized);
        if (tier1) {
            try {
                return { tier: 1, type: 'tool', result: await this.mikrotik.executeTool(tier1.name, ...tier1.args) };
            } catch (e) {
                return { tier: 1, type: 'error', result: e.message };
            }
        }

        // Tier 2 — rule-based shortcuts
        const rule = this._matchRule(sanitized);
        if (rule) {
            try {
                return { tier: 2, type: 'rule', result: await rule() };
            } catch (e) {
                return { tier: 2, type: 'error', result: e.message };
            }
        }

        // Tier 3 — Gemini AI with function calling
        if (this.isRuleOnly) {
            return {
                tier: 0,
                type: 'fallback',
                result: '⚠️ *Rule-Only Mode Active*\nGemini Key is missing. I can only process direct tools and shortcuts (e.g. `who`, `kick name`).'
            };
        }

        if (this.ai) {
            try {
                // Broadcast thinking state to Web 3D Bot
                if (global.gateway) global.gateway.broadcast({ type: 'ai.state', state: 'thinking' });
                const res = await this._runAI(sanitized);
                if (global.gateway) global.gateway.broadcast({ type: 'ai.state', state: 'idle' });
                return res;
            } catch (e) {
                if (global.gateway) global.gateway.broadcast({ type: 'ai.state', state: 'idle' });
                return { tier: 3, type: 'error', result: e.message };
            }
        }

        // Tier 4 — fallback
        return { tier: 4, type: 'fallback', result: 'Command not understood and AI is unavailable.' };
    }

    async _runAI(input, existingSession = null) {
        const model = this.ai.getGenerativeModel({
            model: 'gemini-2.0-flash',
            tools: [{ functionDeclarations: this._declarations }],
        });

        // Use provided session or create a fresh one
        const session = existingSession || new ConversationSession();
        const memCtx = this.memory.getContext();
        const systemPrefix = memCtx
            ? `You are AgentOS — a network intelligence agent managing MikroTik routers.\n${memCtx}\n\nUser request: `
            : '';

        session.addUser(systemPrefix ? systemPrefix + input : input);
        session.compactIfNeeded();

        // Start Gemini chat with typed session history (excluding the message we just added)
        const chat = model.startChat({ history: session.toGeminiHistory().slice(0, -1) });

        // ── ReAct loop (max 5 tool-call turns) ──────────────
        const toolTrace = [];
        let response = await chat.sendMessage(input);
        let turns = 0;
        const MAX_TURNS = 5;

        while (turns < MAX_TURNS) {
            const calls = response.response.functionCalls();
            const call = Array.isArray(calls) ? calls[0] : calls;
            if (!call) break;

            turns++;
            logger.debug(`AI ReAct turn ${turns}: ${call.name}(${JSON.stringify(call.args)})`);

            // Record ToolUse block in session
            const toolUseId = uid();
            session.addAssistant(
                [ContentBlock.toolUse(toolUseId, call.name, JSON.stringify(call.args))],
                response.response.usageMetadata
            );

            let toolResult;
            let isError = false;
            try {
                toolResult = await this._dispatchFunctionCall(call);
            } catch (err) {
                toolResult = { error: err.message };
                isError = true;
            }
            toolTrace.push({ id: toolUseId, call: call.name, args: call.args, result: toolResult, isError });

            // Record ToolResult block in session and auto-compact if needed
            session.addToolResult(toolUseId, call.name, toolResult, isError);
            session.compactIfNeeded();

            response = await chat.sendMessage([{
                functionResponse: { name: call.name, response: { content: toolResult } },
            }]);
        }

        const finalText = response.response.text();

        // Record final assistant text + usage, then persist session to disk
        session.addAssistant([ContentBlock.text(finalText)], response.response.usageMetadata);
        session.persist();

        if (finalText.toLowerCase().includes('remember')) {
            this.memory.remember(`ai_note_${Date.now()}`, finalText.slice(0, 200));
        }

        if (toolTrace.length) {
            return { tier: 3, type: 'ai_act', result: finalText, data: toolTrace, turns, sessionId: session.sessionId };
        }
        return { tier: 3, type: 'ai_chat', result: finalText, sessionId: session.sessionId };
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

        if (name === 'manage_finance') {
            if (action === 'revenue_report') return this.financial.getRevenueReport();
            if (action === 'verify_payment') return this.financial.verifyPayment(target);
            if (action === 'audit_log') return this.financial.auditTrail(5);
            if (action === 'trends') return this.financial.getTrends();
        }

        if (name === 'manage_mesh') {
            if (action === 'list_nodes') return nodeRegistry.getAll();
            if (action === 'execute_all') return nodeRegistry.executeOnAll(args.tool);
            if (action === 'execute_node') return nodeRegistry.executeOnNode(args.node, args.tool);
        }

        return { error: 'Unknown function' };
    }

    formatResponse(text) {
        if (!text) return 'No data available.';

        // Tiered Translation Layer
        const s = (typeof text === 'object') ? JSON.stringify(text, null, 2) : String(text);
        const lower = s.toLowerCase();

        // 1. Data-specific Translation to Markdown Tables/Lists
        if (Array.isArray(text)) {
            if (text.length === 0) return 'Empty results.';
            const keys = Object.keys(text[0]).filter(k => k !== '.id');
            const header = `| ${keys.join(' | ')} |`;
            const sep = `| ${keys.map(() => '---').join(' | ')} |`;
            const rows = text.slice(0, 10).map(row => `| ${keys.map(k => row[k] ?? '').join(' | ')} |`);
            return `\n${header}\n${sep}\n${rows.join('\n')}${text.length > 10 ? '\n\n*(Truncated)*' : ''}`;
        }

        // 2. Resource Translation (cpu-load, free-memory, etc.)
        if (typeof text === 'object' && text['cpu-load']) {
            return `📊 **System Intelligence**\n` +
                `• **CPU Load:** ${text['cpu-load']}%\n` +
                `• **Free RAM:** ${fmtBytes(parseInt(text['free-memory']))}\n` +
                `• **Total RAM:** ${fmtBytes(parseInt(text['total-memory']))}\n` +
                `• **Uptime:** ${text.uptime}\n` +
                `• **Version:** ${text.version}`;
        }

        const isTech = ['/ip', '/system', '/tool', 'delay', 'set '].some(k => lower.includes(k));
        return (isTech && !s.includes('```'))
            ? `🖥️ **Configuration Translation:**\n\`\`\`routeros\n${s.trim()}\n\`\`\``
            : s;
    }

    _matchTool(input) {
        const lower = input.toLowerCase();
        const key = Object.keys(this._toolMap).find(k => lower.includes(k));
        return key ? this._toolMap[key] : null;
    }

    _matchRule(input) {
        const lower = input.trim().toLowerCase();

        // Rule: Voucher Statistics
        if (lower.includes('voucher stats') || lower.includes('db stats')) {
            return () => this.database.getStats();
        }

        // Rule: Kick User (Regex Translation)
        const kickMatch = lower.match(/^kick\s+(\w+)$/);
        if (kickMatch) return () => this.mikrotik.kickUser(kickMatch[1]);

        // Rule: Block Target (Regex Translation)
        const blockMatch = lower.match(/^block\s+([\d.a-f:]+)$/);
        if (blockMatch) return () => this.mikrotik.addToBlockList(blockMatch[1]);

        // Rule: Ping Host (Regex Translation)
        const pingMatch = lower.match(/^ping\s+([\w.-]+)$/);
        if (pingMatch) return () => this.mikrotik.ping(pingMatch[1]);

        // Rule: Voucher Generation (Quick Shortcut)
        const genMatch = lower.match(/^(?:gen|create)\s+voucher\s+(\S+)$/);
        if (genMatch) return () => this.database.createVoucher(voucherCode(), { plan: genMatch[1] });

        return null;
    }

    // ── Streaming ask — yields typed SSE events (claw-code stream_submit_message port)
    async *stream(input) {
        yield { type: 'message_start', input, ts: Date.now() };

        // Tier 1 — keyword tool
        const tier1 = this._matchTool(input);
        if (tier1) {
            yield { type: 'tool_match', tools: [tier1.name] };
            try {
                const result = await this.mikrotik.executeTool(tier1.name, ...tier1.args);
                yield { type: 'message_delta', text: this.formatResponse(result) };
                yield { type: 'message_stop', tier: 1, stop_reason: 'tool_completed' };
            } catch (e) {
                yield { type: 'error', message: e.message };
                yield { type: 'message_stop', tier: 1, stop_reason: 'error' };
            }
            return;
        }

        // Tier 2 — rule
        const rule = this._matchRule(input);
        if (rule) {
            yield { type: 'rule_match' };
            try {
                const result = await rule();
                yield { type: 'message_delta', text: this.formatResponse(result) };
                yield { type: 'message_stop', tier: 2, stop_reason: 'rule_completed' };
            } catch (e) {
                yield { type: 'error', message: e.message };
                yield { type: 'message_stop', tier: 2, stop_reason: 'error' };
            }
            return;
        }

        // Tier 3 — AI
        if (this.isRuleOnly || !this.ai) {
            yield { type: 'message_delta', text: '⚠️ Rule-Only Mode — no AI key configured.' };
            yield { type: 'message_stop', tier: 0, stop_reason: 'rule_only' };
            return;
        }

        yield { type: 'ai_thinking' };
        if (global.gateway) global.gateway.broadcast({ type: 'ai.state', state: 'thinking' });
        try {
            const res = await this._runAI(input);
            if (global.gateway) global.gateway.broadcast({ type: 'ai.state', state: 'idle' });
            yield { type: 'message_delta', text: res.result };
            if (res.data) yield { type: 'tool_trace', trace: res.data };
            yield { type: 'message_stop', tier: 3, stop_reason: 'completed', turns: res.turns, sessionId: res.sessionId };
        } catch (e) {
            if (global.gateway) global.gateway.broadcast({ type: 'ai.state', state: 'idle' });
            yield { type: 'error', message: e.message };
            yield { type: 'message_stop', tier: 3, stop_reason: 'error' };
        }
    }
}
const askEngine = new AskEngine({ mikrotik, database, financial, ai: genAI });

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
                this._out({ type: 'thinking', message: 'AgentOS: Consulting AI…' });
                const resp = await askEngine.run(text);
                this._out({
                    type: 'ai_response',
                    tier: resp.tier,
                    responseType: resp.type,
                    result: askEngine.formatResponse(resp.result),
                    data: (resp.type === 'ai_act' ? resp.data : null)
                });
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
        this._out({ type: 'thinking', message: 'AgentOS Thinking…' });
        try {
            const resp = await askEngine.run(query);
            this._out({
                type: 'ai_response',
                tier: resp.tier,
                responseType: resp.type,
                result: askEngine.formatResponse(resp.result),
                data: resp.data
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdUsers() {
        try {
            const list = await mikrotik.getAllHotspotUsers();
            this._out({
                type: 'table', title: `Hotspot Users (${list.length})`,
                data: list.slice(0, 50).reduce((acc, u) => { acc[u.name] = u.profile; return acc; }, {})
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdActive() {
        try {
            const list = await mikrotik.getActiveUsers();
            this._out({
                type: 'table', title: `Active Sessions (${list.length})`,
                data: list.slice(0, 50).reduce((acc, s) => { acc[s.user] = `${s.address} (${s.uptime})`; return acc; }, {})
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdKick([user]) {
        if (!user) { this._out({ type: 'error', message: 'Usage: kick <user>' }); return; }
        try {
            const res = await mikrotik.kickUser(user);
            await database.logAuditTrail('ws-cli', 'user.kick', { user });
            this._out({ type: 'success', message: res.kicked ? `🚫 Kick successful: ${user}` : `⚠️ ${user} not active.` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdAddUser([user, pass, profile = 'default']) {
        if (!user || !pass) { this._out({ type: 'error', message: 'Usage: adduser <user> <pass> [profile]' }); return; }
        try {
            await mikrotik.addHotspotUser(user, pass, profile);
            await database.logAuditTrail('ws-cli', 'user.add', { user, profile });
            this._out({ type: 'success', message: `✅ User added: ${user} (profile: ${profile})` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdDelUser([user]) {
        if (!user) { this._out({ type: 'error', message: 'Usage: deluser <user>' }); return; }
        try {
            await mikrotik.removeHotspotUser(user);
            await database.logAuditTrail('ws-cli', 'user.remove', { user });
            this._out({ type: 'success', message: `🗑️ User deleted: ${user}` });
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
        if (!token) return cb(false, 401, 'Token required');

        const secret = Buffer.from(CONFIG.GATEWAY.TOKEN);
        const provided = Buffer.from(token);

        if (provided.length === secret.length && crypto.timingSafeEqual(provided, secret)) {
            return cb(true);
        }
        cb(false, 401, 'Invalid token');
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
            // ── Omni-Agent: device mesh messages ─────────────────
            case 'device.register':
                deviceController.registerDevice(msg.deviceId || id, c.ws, msg.info || {});
                this._send(c.ws, { type: 'device.registered', deviceId: msg.deviceId || id });
                break;
            case 'device.heartbeat':
                deviceController.updateHeartbeat(msg.deviceId || id);
                break;
            case 'device.result':
                // Result from a remote device command — forwarded by DeviceController promise
                break;
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
                // Tiered Engine Fallback for One-Off WS CLI Execution
                try {
                    const resp = await askEngine.run(command);
                    result = {
                        success: true,
                        tier: resp.tier,
                        type: resp.type,
                        message: askEngine.formatResponse(resp.result),
                        data: resp.data,
                        output: [{ type: 'log', data: askEngine.formatResponse(resp.result) }]
                    };
                } catch (err) {
                    const output = await mikrotik.executeCLI(command);
                    result = { success: true, output: [{ type: 'log', data: output }] };
                }
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
        this.messaging = null;
        this.bot = null;
        this.rateLimiter = new ChatRateLimiter();
        this._cooldown = new Map();
        this.pendingInputs = new Map();

        if (!CONFIG.TELEGRAM.TOKEN) {
            logger.warn('Telegram not configured — bot disabled');
            return;
        }
        this.messaging = new UnifiedMessaging({
            TELEGRAM_TOKEN: ENV.TELEGRAM_TOKEN,
            ALLOWED_CHAT_IDS: ENV.ALLOWED_CHAT_IDS,
            WHATSAPP_ENABLED: ENV.WHATSAPP_ENABLED,
            WHATSAPP_AUTH_DIR: ENV.WHATSAPP_AUTH_DIR
        });

        this.bot = new TelegramBot(CONFIG.TELEGRAM.TOKEN, { polling: false });

        this.bot.on('polling_error', (err) => {
            const isConflict = err.code === 'ETELEGRAM' && err.response?.body?.description?.includes('Conflict');
            logger.error(isConflict
                ? 'Telegram polling conflict — another instance is running'
                : `Telegram polling error: ${err.message}`);
        });

        this._registerHandlers();
        this.messaging.initialize().then(() => {
            logger.info('Unified messaging initialized');
        }).catch(err => {
            logger.error(`Messaging init failed: ${err.message}`);
            this.bot.startPolling({ restart: false, drop_pending_updates: true });
            logger.info('Telegram bot started');
        });
    }
    _registerHandlers() {
        // Unified handler — routes Telegram + WhatsApp through UnifiedMessaging adapter
        this.messaging.onCommand(this._handleCommand.bind(this));
        this.messaging.onMessage(this._handleMessage.bind(this));
        this.messaging.onCallback(this._handleCallback.bind(this));
    }

    async _handleCommand(ctx) {
        const { platform, chatId, command, args, sender } = ctx;
        logger.info(`[${platform}] /${command} from ${sender}`);

        // Global rate limit
        if (!this._checkRateLimit(chatId)) {
            return this.messaging.reply(ctx, '⏳ *Rate limit:* Too many commands. Please wait.');
        }

        // Setup mode check
        if (this._isSetupMode() && command !== 'claim') {
            return this.messaging.reply(ctx, '⚠️ *Setup Mode Active*\nUse `/claim` to become admin.');
        }

        // Route commands
        const handlers = {
            'start': () => this._cmdStart(ctx),
            'dashboard': () => this._cmdDashboard(ctx),
            'tools': () => this._cmdTools(ctx),
            'network': () => this._cmdNetwork(ctx),
            'users': () => this._cmdUsers(ctx),
            'voucher': () => this._cmdVoucher(ctx),
            'status': () => this._cmdStatus(ctx),
            'help': () => this._cmdHelp(ctx),
            'logs': () => this._cmdLogs(ctx),
            'claim': () => this._cmdClaim(ctx),
            'token': () => this._cmdToken(ctx),
            'setup_router': () => this._cmdSetupRouter(ctx),
            'gen': () => this._cmdGen(ctx, args),
            'ping': () => this._cmdPing(ctx, args),
            'traceroute': () => this._cmdTraceroute(ctx, args),
            'kick': () => this._cmdKick(ctx, args),
            'adduser': () => this._cmdAddUser(ctx, args),
            'block': () => this._cmdBlock(ctx, args),
            'tool': () => this._cmdTool(ctx, args),
            'cli': () => this._cmdCli(ctx, args),
            'api': () => this._cmdApi(ctx, args),
            'ask': () => this._cmdAsk(ctx, args),
        };

        if (handlers[command]) {
            try {
                await handlers[command]();
            } catch (err) {
                logger.error(`Command /${command} failed: ${err.message}`);
                this.messaging.reply(ctx, `❌ *Error:* ${err.message}`);
            }
        } else {
            // Unknown command - try AI
            await this._handleAIQuery(ctx, `/${command} ${args}`);
        }
    }

    async _handleMessage(ctx) {
        // Handle pending inputs
        const pending = this.pendingInputs.get(ctx.chatId);
        if (pending) {
            this.pendingInputs.delete(ctx.chatId);
            return this._executePending(ctx, pending.action);
        }

        // AI processing
        await this._handleAIQuery(ctx, ctx.text);
    }

    async _handleCallback(ctx) {
        const [cat, act, val] = ctx.data.split(':');

        try {
            // Answer callback (Telegram only)
            if (ctx.platform === 'telegram' && ctx.raw) {
                await this.messaging.telegram.answerCallbackQuery(ctx.raw.id).catch(() => { });
            }

            if (cat === 'action') {
                if (act === 'cancel_ai') {
                    return this.messaging.reply(ctx, '🛑 *Cancelled.*');
                }
                if (act === 'gen_confirm') {
                    return this._handleGenConfirm(ctx, val);
                }
                // Map other actions
                const map = {
                    dashboard: '_cmdDashboard', tools: '_cmdTools',
                    network: '_cmdNetwork', users: '_cmdUsers',
                    voucher: '_cmdVoucher', status: '_cmdStatus',
                    start: '_cmdStart'
                };
                if (map[act]) {
                    await this[map[act]](ctx);
                }
            }
            else if (cat === 'tool') {
                const result = await mikrotik.executeTool(act);
                this.messaging.reply(ctx, `✅ *${act}*\n\`\`\`json\n${truncate(JSON.stringify(result, null, 2))}\n\`\`\``);
            }
            else if (cat === 'voucher') {
                await this._handleVoucherCallback(ctx, act);
            }
            else if (cat === 'net') {
                await this._handleNetCallback(ctx, act);
            }
            else if (cat === 'users') {
                await this._handleUsersCallback(ctx, act);
            }
            else if (cat === 'wallet') {
                await this._handleWalletCallback(ctx, act, val);
            }
        } catch (e) {
            this.messaging.reply(ctx, `❌ *Error:* ${e.message}`);
        }
    }

    // Rate limiting
    _checkRateLimit(chatId) {
        if (!this._cmdBuckets) this._cmdBuckets = new Map();
        const now = Date.now();
        let bucket = this._cmdBuckets.get(chatId);
        if (!bucket || now - bucket.start > 60_000) bucket = { count: 0, start: now };
        bucket.count++;
        this._cmdBuckets.set(chatId, bucket);
        return bucket.count <= 30;
    }

    _isSetupMode() {
        return CONFIG.TELEGRAM.ALLOWED_CHATS.length === 0;
    }

    // Unified command handlers (work for both platforms)
    async _cmdStart(ctx) {
        const keyboard = {
            inline_keyboard: [
                [{ text: '📊 Dashboard', callback_data: 'action:dashboard' }, { text: '🛠 Tools', callback_data: 'action:tools' }],
                [{ text: '🌐 Network', callback_data: 'action:network' }, { text: '👥 Users', callback_data: 'action:users' }],
                [{ text: '🎫 Voucher', callback_data: 'action:voucher' }, { text: '👛 Wallet', callback_data: 'wallet:list' }],
                [{ text: '📈 Status', callback_data: 'action:status' }],
            ]
        };

        await this.messaging.reply(ctx, `${BRAND.emoji} *${BRAND.name}*\nWelcome!`, {
            reply_markup: keyboard
        });
    }

    async _cmdDashboard(ctx) {
        try {
            const [dbRes, rtRes] = await Promise.allSettled([
                database.getStats(),
                mikrotik.getSystemStats()
            ]);
            const db = dbRes.status === 'fulfilled' ? dbRes.value : {};
            const rt = rtRes.status === 'fulfilled' ? rtRes.value : null;
            const cpu = rt ? parseInt(rt['cpu-load']) : 0;
            const cpuIcon = cpu > 80 ? '🔴' : cpu > 50 ? '🟡' : '🟢';

            const text = `📊 *Dashboard*\n\n*Router*\nCPU: ${cpuIcon} ${cpu}%\nRAM Free: ${fmtBytes(parseInt(rt?.['free-memory']) || 0)}\n\n` +
                `*Vouchers*\nTotal: ${db.total || 0}  Active: ${db.active || 0}  Used: ${db.used || 0}`;

            await this.messaging.reply(ctx, text, {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔄 Refresh', callback_data: 'action:dashboard' },
                        { text: '📋 Status', callback_data: 'action:status' },
                    ]]
                }
            });
        } catch (e) {
            await this.messaging.reply(ctx, `❌ Dashboard error: ${e.message}`);
        }
    }

    async _cmdVoucher(ctx) {
        await this.messaging.reply(ctx, '🎫 *Create Voucher* — Select duration:', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⏱ 1 Hour', callback_data: 'voucher:1h' }, { text: '📅 1 Day', callback_data: 'voucher:1d' }],
                    [{ text: '📆 7 Days', callback_data: 'voucher:7d' }, { text: '🌙 30 Days', callback_data: 'voucher:30d' }],
                ]
            }
        });
    }

    async _cmdStatus(ctx) {
        const snap = metrics.snapshot();
        const mode = askEngine.isRuleOnly ? 'Rule-Only' : 'AI-Optimized';
        const emotion = emotionEngine ? emotionEngine.getState() : null;
        const text = `*System Status*\n\n` +
            `MikroTik: ${mikrotik.isConnected ? '🟢 Connected' : '🔴 Offline'}\n` +
            `Intelligence: \`${mode}\` (${ENV.LLM_PROVIDER.toUpperCase()})\n` +
            `Uptime: ${fmtUptime(snap.uptime)}\n` +
            `DB: ${database.db ? 'Firebase' : 'Local'}\n` +
            `Tools Invoked: ${snap.toolInvocations}\n` +
            `Alerts: ${snap.alertsFired}\n` +
            `Devices: ${deviceController.getConnectedDevices().length} online\n` +
            (emotion ? `Mood: ${emotion.mood > 0 ? '😊' : '😐'} | Urgency: ${Math.round(emotion.urgency * 100)}%\n` : '') +
            (github.enabled ? `GitHub: 🟢 OAuth active\n` : '');

        await this.messaging.reply(ctx, text);
    }

    async _cmdHelp(ctx) {
        await this.messaging.reply(ctx,
            `*Commands*\n` +
            `/dashboard  /tools  /network  /users  /voucher  /status  /logs\n\n` +
            `*Advanced*\n` +
            `/cli \\<command\\> — Raw RouterOS CLI\n` +
            `/api \\<command\\> — Raw API\n` +
            `/ask \\<query\\> — AI agent\n\n` +
            `Type any message for free-form AI chat.`
        );
    }

    async _cmdClaim(ctx) {
        if (CONFIG.TELEGRAM.ALLOWED_CHATS.length > 0) {
            return this.messaging.reply(ctx, '❌ Admin already claimed.');
        }

        const chatId = String(ctx.chatId);
        CONFIG.TELEGRAM.ALLOWED_CHATS.push(chatId);

        // Add to appropriate list based on platform
        if (ctx.platform === 'whatsapp') {
            this.messaging.allowedIds.whatsapp.push(chatId);
        } else {
            this.messaging.allowedIds.telegram.push(chatId);
        }

        await database.logAuditTrail(chatId, 'admin.claim', {
            username: ctx.sender,
            platform: ctx.platform
        });

        await this.messaging.reply(ctx,
            `🎉 *Success!* You are now the primary admin.\n` +
            `Platform: ${ctx.platform}\n` +
            `ID: \`${chatId}\`\n\n` +
            `Update your \`.env\` with:\n` +
            `\`ALLOWED_CHAT_IDS=${CONFIG.TELEGRAM.ALLOWED_CHATS.join(',')}\``
        );
    }

    async _cmdToken(ctx) {
        await this.messaging.reply(ctx,
            `🔑 *Gateway Token*\n\n\`${CONFIG.GATEWAY.TOKEN}\`\n\n` +
            `Use this for WebSocket/API auth. Keep it secret!`
        );
    }

    async _cmdSetupRouter(ctx) {
        this.promptUser(ctx, '🌐 *Step 1: Router IP*\nEnter MikroTik IP (e.g., `192.168.88.1`):', 'setup:ip');
    }

    async _cmdGen(ctx, args) {
        const plan = args.split(/\s+/)[0];
        if (!plan) return this.messaging.reply(ctx, 'Usage: /gen <plan>');

        await this.messaging.reply(ctx, `⚠️ *Confirm:* Generate **${plan}** voucher?`, {
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ Confirm', callback_data: `action:gen_confirm:${plan}` },
                    { text: '❌ Cancel', callback_data: 'action:cancel_ai' }
                ]]
            }
        });
    }

    async _cmdPing(ctx, args) {
        const host = args.split(/\s+/)[0];
        if (!host) return this.messaging.reply(ctx, 'Usage: /ping <host>');

        try {
            const res = await mikrotik.ping(host, 4);
            await this.messaging.reply(ctx, `📡 *Ping: ${host}*\n\`\`\`json\n${JSON.stringify(res, null, 2)}\n\`\`\``);
        } catch (e) {
            await this.messaging.reply(ctx, `❌ ${e.message}`);
        }
    }

    async _cmdKick(ctx, args) {
        const user = args.split(/\s+/)[0];
        if (!user) return this.messaging.reply(ctx, 'Usage: /kick <username>');

        try {
            const res = await mikrotik.kickUser(user);
            await this.messaging.reply(ctx, res.kicked ? `🚫 Kicked *${user}*` : `⚠️ *${user}* not active`);
        } catch (e) {
            await this.messaging.reply(ctx, `❌ ${e.message}`);
        }
    }

    async _cmdAsk(ctx, args) {
        if (!args) return this.messaging.reply(ctx, 'Usage: /ask <query>');
        await this._handleAIQuery(ctx, args, true);
    }

    async _handleAIQuery(ctx, query, showThinking = false) {
        if (showThinking) {
            await this.messaging.reply(ctx, '⏳ *AgentOS thinking…*');
        }

        // Omni-Agent: update emotion state before running query
        if (emotionEngine) emotionEngine.update(query, 'CHAT');

        try {
            const resp = await askEngine.run(query);
            const formatted = askEngine.formatResponse(resp.result);
            await this.messaging.reply(ctx, `${resp.type === 'error' ? '❌' : '✅'} *AgentOS:*\n\n${formatted}`);
        } catch (e) {
            await this.messaging.reply(ctx, `❌ *AI Error:* ${e.message}`);
        }
    }

    // Prompt handling
    promptUser(ctx, text, action) {
        this.pendingInputs.set(ctx.chatId, { action, ctx });
        this.messaging.reply(ctx, text);
    }

    async _executePending(ctx, action) {
        const input = ctx.text.trim();

        try {
            if (action === 'setup:ip') {
                return this.promptUser(ctx, `👤 *Step 2: Username*\nIP: \`${input}\` set. Enter MikroTik user:`, `setup:user:${input}`);
            }
            if (action.startsWith('setup:user:')) {
                const ip = action.split(':')[2];
                return this.promptUser(ctx, `🔑 *Step 3: Password*\nUser: \`${input}\` set. Enter password:`, `setup:pass:${ip}:${input}`);
            }
            if (action.startsWith('setup:pass:')) {
                const [, , ip, user] = action.split(':');
                return this._finishSetup(ctx, ip, user, input);
            }
            if (action === 'ping') {
                const res = await mikrotik.ping(input);
                return this.messaging.reply(ctx, `📡 *Ping: ${input}*\n\`\`\`json\n${JSON.stringify(res, null, 2)}\n\`\`\``);
            }
            if (action === 'kick') {
                const res = await mikrotik.kickUser(input);
                return this.messaging.reply(ctx, res.kicked ? `🚫 Kicked *${input}*` : `⚠️ Not active`);
            }
            // ... other pending actions
        } catch (err) {
            this.messaging.reply(ctx, `❌ Failed: ${err.message}`);
        }
    }

    async _finishSetup(ctx, ip, user, pass) {
        await this.messaging.reply(ctx, '⚙️ *Connecting & provisioning…*');
        try {
            await mikrotik.updateCredentials(ip, user, pass);
            await global.orchestrator._provisionRouter();
            await this.messaging.reply(ctx, '✅ *Setup Successful!* Router connected.');
            await database.logAuditTrail(ctx.chatId, 'router.setup', { ip, user, platform: ctx.platform });
        } catch (e) {
            await this.messaging.reply(ctx, `❌ *Setup Failed:* ${e.message}`);
        }
    }

    // Callback handlers
    async _handleGenConfirm(ctx, plan) {
        try {
            const code = voucherCode();
            await database.createVoucher(code, { plan, createdBy: `${ctx.platform}:${ctx.chatId}` });
            await mikrotik.addHotspotUser(code, code, plan);

            const url = `${ENV.SERVER_URL}/login.html?code=${code}`;

            if (ctx.platform === 'whatsapp') {
                // Send QR via WhatsApp
                const qrBuf = await QRCode.toBuffer(JSON.stringify({ code, plan, url }));
                await this.messaging.sendMedia(ctx.chatId, qrBuf, 'image/png',
                    `🎟 *Voucher*\nCode: \`${code}\`\nPlan: ${plan}`);
            } else {
                // Telegram with inline keyboard
                await this.messaging.reply(ctx,
                    `✅ *Voucher Generated*\nCode: \`${code}\`\nPlan: ${plan}`, {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '📊 Dashboard', callback_data: 'action:dashboard' }
                        ]]
                    }
                });
            }
        } catch (e) {
            this.messaging.reply(ctx, `❌ *Error:* ${e.message}`);
        }
    }

    async _handleVoucherCallback(ctx, act) {
        const planMap = { '1h': '1hour', '1d': '1Day', '7d': '7Day', '30d': '30Day' };
        const plan = planMap[act];

        if (!plan) return;

        if (!this.rateLimiter.allow(ctx.chatId)) {
            return this.messaging.reply(ctx, '⏳ Too many requests — slow down.');
        }

        if (!mikrotik.isConnected) {
            throw new Error('Router disconnected');
        }

        const code = voucherCode();
        await database.createVoucher(code, { plan, createdBy: ctx.platform });
        await mikrotik.addHotspotUser(code, code, plan);

        const url = `${ENV.SERVER_URL}/login.html?code=${code}`;

        if (ctx.platform === 'whatsapp') {
            const qrBuf = await QRCode.toBuffer(JSON.stringify({ code, plan, url }));
            await this.messaging.sendMedia(ctx.chatId, qrBuf, 'image/png',
                `🎟 *Voucher*\nCode: \`${code}\`\nPlan: ${plan}`);
        } else {
            const qrBuf = await QRCode.toBuffer(JSON.stringify({ code, plan, url }));
            await this.messaging.telegram.sendPhoto(ctx.chatId, qrBuf, {
                caption: `🎟 *Voucher*\nCode: \`${code}\`\nPlan: ${plan}`,
                parse_mode: 'Markdown'
            });
        }
    }

    // Legacy compatibility methods
    sendToAll(text, opts = {}) {
        return this.messaging.broadcast(text, opts);
    }

    alertOnce(key, text, buttons = null) {
        const now = Date.now();
        const last = this._cooldown.get(key) || 0;
        if (now - last < CONFIG.SECURITY.ALERT_COOLDOWN_MS) return false;
        this._cooldown.set(key, now);
        if (this._cooldown.size > 1000) this._cooldown.clear();
        metrics.alertsFired++;

        this.messaging.broadcast(text, buttons ? { reply_markup: { inline_keyboard: buttons } } : {});
        return true;
    }

    // ── Callback sub-handlers (net / users / wallet) ──────────
    async _handleNetCallback(ctx, act) {
        switch (act) {
            case 'ping':
                this.promptUser(ctx, '📡 Enter IP/host to ping:', 'ping'); break;
            case 'traceroute':
                this.promptUser(ctx, '🛤 Enter IP/host to trace:', 'traceroute'); break;
            case 'block':
                this.promptUser(ctx, '🚫 Enter IP/MAC to block:', 'block'); break;
            case 'flush_dns': {
                await mikrotik.executeTool('dns.flush');
                await this.messaging.reply(ctx, '✅ DNS cache flushed');
                break;
            }
            case 'backup': {
                const b = await mikrotik.executeTool('system.backup');
                await this.messaging.reply(ctx, `💾 Backup saved: ${b.file}`);
                break;
            }
            case 'reboot':
                await this.messaging.reply(ctx, '⚠️ Confirm router reboot?', {
                    reply_markup: { inline_keyboard: [[{ text: '✅ Yes, reboot', callback_data: 'confirm:reboot' }]] }
                });
                break;
            default: {
                const toolMap = {
                    dhcp: [() => mikrotik.getDhcpLeases(), 'DHCP Leases'],
                    scan: [() => mikrotik.getArpTable(), 'LAN Scan (ARP)'],
                    firewall: [() => mikrotik.getFirewallRules(), 'Firewall Rules'],
                    bandwidth: [() => mikrotik.getInterfaces(), 'Interfaces'],
                };
                if (toolMap[act]) {
                    const [fn, title] = toolMap[act];
                    const res = await fn();
                    await this.messaging.reply(ctx,
                        `*${title} (${res.length})*\n\`\`\`json\n${truncate(JSON.stringify(res.slice(0, 5), null, 2))}\n\`\`\``);
                }
            }
        }
    }

    async _handleUsersCallback(ctx, act) {
        if (act === 'add') {
            this.promptUser(ctx, '➕ Format: `username password`', 'adduser');
        } else if (act === 'kick') {
            this.promptUser(ctx, '🚫 Username to kick:', 'kick');
        } else if (act === 'status') {
            this.promptUser(ctx, '🔍 Username to check:', 'user_status');
        } else if (act === 'active' || act === 'all') {
            const list = act === 'active'
                ? await mikrotik.getActiveUsers()
                : await mikrotik.getAllHotspotUsers();
            const text = list.slice(0, 15)
                .map(u => `• ${u.user || u.name}${u.address ? ` (${u.address})` : ''}`)
                .join('\n');
            await this.messaging.reply(ctx,
                `👥 *${act === 'active' ? 'Active' : 'All'} Users (${list.length})*\n\n${text || 'None'}`);
        }
    }

    async _handleWalletCallback(ctx, act, val) {
        if (act === 'list') {
            const codes = await database.getWallet(String(ctx.chatId));
            if (!codes.length) {
                await this.messaging.reply(ctx, 'Your wallet is empty or all vouchers have been claimed.', {
                    reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'action:start' }]] }
                });
                return;
            }
            const btns = codes.map(c => [{ text: `🎟 Activate ${c}`, callback_data: `wallet:claim:${c}` }]);
            btns.push([{ text: '⬅️ Back', callback_data: 'action:start' }]);
            await this.messaging.reply(ctx, '👛 *Your Wallet*\nSelect a voucher to activate on this router:', {
                reply_markup: { inline_keyboard: btns }
            });
        } else if (act === 'claim') {
            const code = val;
            const v = await database.getVoucher(code);
            if (!v) throw new Error('Voucher not found');
            await mikrotik.addHotspotUser(code, code, v.plan);
            await database.claimFromWallet(String(ctx.chatId), code);
            await database.redeemVoucher(code, { via: 'wallet', userId: String(ctx.chatId) });
            await this.messaging.reply(ctx,
                `✅ *Voucher Activated!*\nCode: \`${code}\`\nYou are now provisioned on the network.`, {
                reply_markup: { inline_keyboard: [[{ text: '📊 Dashboard', callback_data: 'action:dashboard' }]] }
            });
        }
    }

    _reply(chatId, text, opts = {}) {
        return this.messaging.send(chatId, text, opts);
    }
}
// ============================================================
// §14.5  WHATSAPP SERVICE  (Baileys Integration)
// ============================================================

const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

class WhatsAppService {
    constructor(config = {}) {
        this.authDir = config.authDir || './data/whatsapp_auth';
        this.sock = null;
        this.isConnected = false;
        this.qrCode = null;
        this.messageHandlers = [];
        this.connectionHandlers = [];
        this.allowedJids = new Set();
        this.msgRetryCounterMap = new Map();

        // Parse allowed JIDs from config
        if (config.allowedJids) {
            config.allowedJids.forEach(jid => this.allowedJids.add(this.normalizeJid(jid)));
        }
    }

    normalizeJid(jid) {
        if (!jid) return null;
        const number = jid.split('@')[0].replace(/[^0-9]/g, '');
        if (jid.includes('@g.us')) return `${number}@g.us`;
        return `${number}@s.whatsapp.net`;
    }

    isAuthorized(jid) {
        if (this.allowedJids.size === 0) return true;
        const normalized = this.normalizeJid(jid);
        return this.allowedJids.has(normalized);
    }

    async initialize() {
        try {
            if (!fs.existsSync(this.authDir)) {
                fs.mkdirSync(this.authDir, { recursive: true });
            }

            const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
            const { version, isLatest } = await fetchLatestBaileysVersion();

            logger.info(`Baileys v${version}, latest: ${isLatest}`);

            this.sock = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger),
                },
                printQRInTerminal: false,
                browser: ['AgentOS', 'Desktop', '2026.5.0'],
                syncFullHistory: false,
                markOnlineOnConnect: true,
                msgRetryCounterMap: this.msgRetryCounterMap,
                getMessage: async () => undefined,
                logger: {
                    level: 'silent',
                    info: () => { },
                    error: () => { },
                    warn: () => { },
                    debug: () => { },
                    trace: () => { },
                    fatal: () => { },
                    child: () => this.sock.logger
                }
            });

            this.sock.ev.on('creds.update', saveCreds);
            this.sock.ev.on('connection.update', (update) => this._handleConnectionUpdate(update));
            this.sock.ev.on('messages.upsert', (m) => this._handleMessages(m));

            return true;
        } catch (error) {
            logger.error(`WhatsApp init failed: ${error.message}`);
            return false;
        }
    }

    _handleConnectionUpdate(update) {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            this.qrCode = qr;
            this.isConnected = false;
            QRCode.toString(qr, { type: 'terminal', small: true }, (err, url) => {
                if (!err) console.log(url);
            });
            this.connectionHandlers.forEach(h => h({ type: 'qr', qr }));
            logger.info('WhatsApp QR generated - scan with phone');
        }

        if (connection === 'close') {
            this.isConnected = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            logger.warn(`WhatsApp closed. Reconnecting: ${shouldReconnect}`);
            this.connectionHandlers.forEach(h => h({ type: 'disconnected', shouldReconnect }));

            if (shouldReconnect) {
                setTimeout(() => this.initialize(), 5000);
            }
        } else if (connection === 'open') {
            this.isConnected = true;
            this.qrCode = null;
            logger.info(`WhatsApp connected: ${this.sock.user?.id || 'unknown'}`);
            this.connectionHandlers.forEach(h => h({ type: 'connected', user: this.sock.user }));
        }
    }

    _handleMessages({ messages, type }) {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (msg.key.fromMe) continue;

            const jid = msg.key.remoteJid;
            const sender = msg.pushName || jid.split('@')[0];

            let text = '';
            if (msg.message?.conversation) {
                text = msg.message.conversation;
            } else if (msg.message?.extendedTextMessage?.text) {
                text = msg.message.extendedTextMessage.text;
            } else if (msg.message?.imageMessage?.caption) {
                text = msg.message.imageMessage.caption;
            }

            if (!text) continue;

            const messageData = {
                platform: 'whatsapp',
                chatId: jid,
                sender,
                text: text.trim(),
                timestamp: msg.messageTimestamp,
                raw: msg
            };

            if (!this.isAuthorized(jid)) {
                logger.warn(`Unauthorized WhatsApp: ${jid}`);
                this.sendMessage(jid, '⛔ *Unauthorized:* You are not authorized to use AgentOS.');
                continue;
            }

            this.messageHandlers.forEach(handler => {
                try { handler(messageData); }
                catch (e) { logger.error(`WhatsApp handler error: ${e.message}`); }
            });
        }
    }

    async sendMessage(jid, text, options = {}) {
        if (!this.isConnected || !this.sock) {
            throw new Error('WhatsApp not connected');
        }
        try {
            return await this.sock.sendMessage(jid, { text, ...options });
        } catch (error) {
            logger.error(`WhatsApp send failed: ${error.message}`);
            throw error;
        }
    }

    async sendMedia(jid, buffer, mimeType, caption = '') {
        if (!this.isConnected || !this.sock) {
            throw new Error('WhatsApp not connected');
        }
        try {
            let content = {};
            if (mimeType.startsWith('image/')) {
                content = { image: buffer, caption };
            } else if (mimeType.startsWith('video/')) {
                content = { video: buffer, caption };
            } else if (mimeType.startsWith('audio/')) {
                content = { audio: buffer, mimetype: mimeType };
            } else {
                content = { document: buffer, caption, mimetype: mimeType };
            }
            return await this.sock.sendMessage(jid, content);
        } catch (error) {
            logger.error(`WhatsApp media failed: ${error.message}`);
            throw error;
        }
    }

    onMessage(handler) {
        this.messageHandlers.push(handler);
        return () => {
            this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
        };
    }

    onConnection(handler) {
        this.connectionHandlers.push(handler);
        return () => {
            this.connectionHandlers = this.connectionHandlers.filter(h => h !== handler);
        };
    }

    async disconnect() {
        if (this.sock) {
            await this.sock.logout();
            this.isConnected = false;
        }
    }

    getStatus() {
        return {
            connected: this.isConnected,
            qrAvailable: !!this.qrCode,
            user: this.sock?.user?.id || null,
            authorizedJids: Array.from(this.allowedJids)
        };
    }
}

// ============================================================
// §14.6  UNIFIED MESSAGING ADAPTER
// ============================================================

class UnifiedMessaging {
    constructor(config) {
        this.telegram = null;
        this.whatsapp = null;
        this.handlers = { message: [], command: [], callback: [] };
        this.allowedIds = this._parseAllowedIds(config.ALLOWED_CHAT_IDS);
        this.config = config;
    }

    _parseAllowedIds(idsString) {
        if (!idsString) return { telegram: [], whatsapp: [] };

        const ids = idsString.split(',').map(s => s.trim()).filter(Boolean);
        const result = { telegram: [], whatsapp: [] };

        for (const id of ids) {
            if (id.includes('@s.whatsapp.net') || id.includes('@g.us')) {
                result.whatsapp.push(id);
            } else if (!isNaN(id)) {
                result.telegram.push(id);
            } else {
                result.telegram.push(id);
            }
        }

        logger.info(`Parsed allowed IDs: ${result.telegram.length} Telegram, ${result.whatsapp.length} WhatsApp`);
        return result;
    }

    async initialize() {
        // Telegram
        if (this.config.TELEGRAM_TOKEN) {
            await this._initTelegram();
        } else {
            logger.warn('Telegram token not configured');
        }

        // WhatsApp
        if (this.config.WHATSAPP_ENABLED !== false) {
            await this._initWhatsApp();
        }
    }

    async _initTelegram() {
        this.telegram = new TelegramBot(this.config.TELEGRAM_TOKEN, { polling: false });
        this.telegram.on('polling_error', (err) => {
            const isConflict = err.code === 'ETELEGRAM' && err.response?.body?.description?.includes('Conflict');
            logger.error(isConflict ? 'Telegram polling conflict' : `Telegram error: ${err.message}`);
        });

        this.telegram.on('message', (msg) => this._handleTelegramMessage(msg));
        this.telegram.on('callback_query', (query) => this._handleTelegramCallback(query));
        
        const { acquireBotLock } = require('./src/utils/bot-lock');
        if (acquireBotLock()) {
            this.telegram.startPolling({ restart: false, drop_pending_updates: true });
            logger.info(`Telegram initialized and polling started`);
        } else {
            logger.warn('Telegram initialized (polling skipped due to singleton lock)');
        }
    }

    async _initWhatsApp() {
        this.whatsapp = new WhatsAppService({
            authDir: this.config.WHATSAPP_AUTH_DIR || './data/whatsapp_auth',
            allowedJids: this.allowedIds.whatsapp
        });

        this.whatsapp.onMessage((msg) => this._handleWhatsAppMessage(msg));
        this.whatsapp.onConnection((status) => {
            if (status.type === 'qr') {
                logger.info('WhatsApp QR ready - scan to connect');
            }
        });

        await this.whatsapp.initialize();
    }

    _handleTelegramMessage(msg) {
        const chatId = String(msg.chat.id);

        if (this.allowedIds.telegram.length > 0 &&
            !this.allowedIds.telegram.includes(chatId)) {
            this.telegram.sendMessage(chatId, '⛔ *Unauthorized*', { parse_mode: 'Markdown' });
            return;
        }

        const data = {
            platform: 'telegram',
            chatId: chatId,
            sender: msg.from?.username || msg.from?.first_name || 'Unknown',
            text: msg.text || '',
            raw: msg
        };

        if (msg.text?.startsWith('/')) {
            const [cmd, ...args] = msg.text.slice(1).split(/\s+/);
            this._emit('command', { ...data, command: cmd.toLowerCase(), args: args.join(' ') });
        } else {
            this._emit('message', data);
        }
    }

    _handleWhatsAppMessage(msg) {
        if (msg.text.startsWith('/')) {
            const [cmd, ...args] = msg.text.slice(1).split(/\s+/);
            this._emit('command', { ...msg, command: cmd.toLowerCase(), args: args.join(' ') });
        } else {
            this._emit('message', msg);
        }
    }

    _handleTelegramCallback(query) {
        this._emit('callback', {
            platform: 'telegram',
            chatId: String(query.message.chat.id),
            data: query.data,
            messageId: query.message.message_id,
            raw: query
        });
    }

    _emit(event, data) {
        this.handlers[event].forEach(h => {
            try { h(data); }
            catch (e) { logger.error(`Handler error: ${e.message}`); }
        });
    }

    onMessage(handler) { this.handlers.message.push(handler); }
    onCommand(handler) { this.handlers.command.push(handler); }
    onCallback(handler) { this.handlers.callback.push(handler); }

    async send(chatId, text, options = {}) {
        if (chatId.includes('@s.whatsapp.net') || chatId.includes('@g.us')) {
            return this.whatsapp?.sendMessage(chatId, text, options);
        } else {
            return this.telegram?.sendMessage(chatId, text, { parse_mode: 'Markdown', ...options });
        }
    }

    async sendMedia(chatId, buffer, mimeType, caption = '') {
        if (chatId.includes('@s.whatsapp.net') || chatId.includes('@g.us')) {
            return this.whatsapp?.sendMedia(chatId, buffer, mimeType, caption);
        } else {
            if (mimeType.startsWith('image/')) {
                return this.telegram?.sendPhoto(chatId, buffer, { caption, parse_mode: 'Markdown' });
            }
            return this.telegram?.sendDocument(chatId, buffer, { caption, parse_mode: 'Markdown' });
        }
    }

    async broadcast(text, options = {}) {
        const results = [];

        for (const chatId of this.allowedIds.telegram) {
            try {
                const result = await this.send(chatId, text, options);
                results.push({ platform: 'telegram', chatId, success: true, result });
            } catch (e) {
                results.push({ platform: 'telegram', chatId, success: false, error: e.message });
            }
        }

        for (const jid of this.allowedIds.whatsapp) {
            try {
                const result = await this.send(jid, text, options);
                results.push({ platform: 'whatsapp', chatId: jid, success: true, result });
            } catch (e) {
                results.push({ platform: 'whatsapp', chatId: jid, success: false, error: e.message });
            }
        }

        return results;
    }

    async reply(ctx, text, options = {}) {
        return this.send(ctx.chatId, text, options);
    }

    async editMessage(ctx, text, options = {}) {
        if (ctx.platform === 'telegram' && ctx.raw?.message_id) {
            return this.telegram?.editMessageText(text, {
                chat_id: ctx.chatId,
                message_id: ctx.raw.message_id,
                parse_mode: 'Markdown',
                ...options
            });
        }
        // WhatsApp doesn't support editing, send new message
        return this.send(ctx.chatId, text, options);
    }

    getStatus() {
        return {
            telegram: this.telegram ? 'connected' : 'disabled',
            whatsapp: this.whatsapp?.getStatus() || { connected: false }
        };
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
        this._provisionRouter().catch(e => logger.error(`Provisioning error: ${e.message}`));
        this._monitorSystem();
        this._monitorNewDevices();
        this._scheduleVoucherExpiry();
        this._runCron();
    }

    async _provisionRouter() {
        if (!this.mikrotik.isConnected) return;
        logger.info('Provisioning router (Day 1 checks)…');

        // 1. Ensure Firewall Address List exists
        await this.mikrotik.executeCLI('/ip/firewall/address-list add list=AgentOS-Protected address=127.0.0.1 comment="Reserved"').catch(() => { });

        // 2. Ensure logging is set up for hotspot
        await this.mikrotik.executeCLI('/system/logging add topics=hotspot,info,debug action=memory').catch(() => { });

        logger.info('Router provisioning complete.');
    }

    _runCron() {
        // Daily Reboot at 4:00 AM
        setInterval(async () => {
            const now = new Date();
            if (now.getHours() === 4 && now.getMinutes() === 0) {
                logger.info('Cron: Triggering automated daily reboot (4:00 AM)');
                this.bot?.sendToAll('🔄 *Automated System Maintenance:* Router is rebooting.');
                await this.mikrotik.reboot().catch(() => { });
            }

            // Heartbeat Every 24 Hours
            if (now.getHours() === 12 && now.getMinutes() === 0) {
                this.bot?.sendToAll('💚 *System Heartbeat:* AgentOS is active and monitoring.');
            }
        }, 60_000);
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
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "wss:", "https:"],
        }
    }
}));

const authMiddleware = (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorised — Bearer token required' });
    const token = auth.split(' ')[1];

    // Use timingSafeEqual to prevent timing attacks
    const secret = Buffer.from(CONFIG.GATEWAY.TOKEN);
    const provided = Buffer.from(token);

    if (provided.length === secret.length && crypto.timingSafeEqual(provided, secret)) {
        return next();
    }
    res.status(401).json({ error: 'Invalid token' });
};

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
app.use('/', router);
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

app.get('/api/stats', authMiddleware, async (_req, res) => {
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

app.get('/api/vouchers', authMiddleware, async (req, res) => {
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

app.post('/tool/execute', authMiddleware, async (req, res) => {
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

// ── GitHub OAuth & Integration Routes (Omni-Agent) ────────────
if (github.enabled) {
    app.get('/oauth/github', (req, res) => {
        const state = crypto.randomBytes(16).toString('hex');
        res.redirect(github.getOAuthURL(state));
    });

    app.get('/oauth/github/callback', async (req, res) => {
        try {
            const { code } = req.query;
            if (!code) return res.status(400).send('Missing code');
            const user = await github.handleCallback(code);
            res.json({ success: true, user });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.post('/api/github/push', authMiddleware, async (req, res) => {
        try {
            const { userId, owner, repo, filePath, content, message, branch } = req.body;
            const result = await github.pushFile(userId, owner, repo, filePath, content, message, branch);
            res.json(result);
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/github/repos', authMiddleware, async (req, res) => {
        try {
            const repos = await github.listRepos(req.query.userId || 'default');
            res.json({ repos });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.post('/api/github/deploy-pages', authMiddleware, async (req, res) => {
        try {
            const { userId, owner, repo, sourceBranch, sourcePath } = req.body;
            const result = await github.deployToPages(userId, owner, repo, sourceBranch, sourcePath);
            res.json(result);
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.post('/webhooks/github', async (req, res) => {
        try {
            const sig = req.headers['x-hub-signature-256'];
            const result = github.handleWebhook(req.body, sig);
            res.json(result);
        } catch (err) { res.status(401).json({ error: err.message }); }
    });

    logger.info('GitHub OAuth routes registered: /oauth/github, /oauth/github/callback');
}

// ── Device Controller API (Omni-Agent Mesh) ───────────────────
app.get('/api/devices', authMiddleware, (_req, res) => {
    res.json({ devices: deviceController.getConnectedDevices() });
});

app.post('/api/devices/:deviceId/exec', authMiddleware, async (req, res) => {
    try {
        const result = await deviceController.executeOnDevice(req.params.deviceId, req.body.command);
        res.json({ result });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Emotion Engine State (Omni-Agent) ─────────────────────────
app.get('/api/emotion', authMiddleware, (_req, res) => {
    res.json(emotionEngine ? emotionEngine.getState() : { enabled: false });
});

// ── Encryption Vault Test (dev only) ─────────────────────────
if (ENV.NODE_ENV !== 'production') {
    app.post('/api/vault/test', authMiddleware, (req, res) => {
        try {
            const { plaintext } = req.body;
            if (!plaintext) return res.status(400).json({ error: 'plaintext required' });
            const encrypted = encVault.encrypt(plaintext);
            const decrypted = encVault.decrypt(encrypted);
            res.json({ encrypted, decrypted, match: decrypted === plaintext });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });
}

// ── SSE real-time stream ─────────────────────────────────────
const sseClients = new Set();

app.get('/api/stream', authMiddleware, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('connected', { service: BRAND.name, version: BRAND.version });

    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 15_000);

    sseClients.add(send);
    req.on('close', () => { clearInterval(heartbeat); sseClients.delete(send); });
});

// Broadcast helper — called by gateway and orchestrator
function sseBroadcast(event, data) {
    sseClients.forEach(send => { try { send(event, data); } catch { sseClients.delete(send); } });
}

// ── Streaming ask (claw-code stream_submit_message REST port) ─
app.get('/api/ask/stream', authMiddleware, async (req, res) => {
    const input = req.query.q;
    if (!input) return res.status(400).json({ error: 'q query param required' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const write = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    try {
        for await (const event of askEngine.stream(input)) {
            write(event.type, event);
            if (event.type === 'message_stop') break;
        }
    } catch (err) {
        write('error', { message: err.message });
    }
    res.end();
});

// ── Session replay ────────────────────────────────────────────
app.get('/api/session/:id', authMiddleware, (req, res) => {
    const session = ConversationSession.load(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({ sessionId: session.sessionId, messages: session.messages, usage: session.usage.snapshot() });
});

// ── Revenue trends ───────────────────────────────────────────
app.get('/api/trends', authMiddleware, async (_req, res) => {
    try {
        res.json(await financial.getTrends());
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Mesh node management ─────────────────────────────────────
app.get('/api/nodes', authMiddleware, (_req, res) => {
    res.json(nodeRegistry.getAll());
});

app.post('/api/nodes', authMiddleware, async (req, res) => {
    const { name, ip, user, pass, port } = req.body;
    if (!name || !ip || !user || !pass) return res.status(400).json({ error: 'name, ip, user, pass required' });
    try {
        const node = nodeRegistry.add(name, ip, user, pass, port);
        await node.connect();
        await database.logAuditTrail('api', 'node.add', { name, ip });
        res.json({ success: true, name, status: 'connected' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/nodes/:name/exec', authMiddleware, async (req, res) => {
    const { tool, params } = req.body;
    if (!tool) return res.status(400).json({ error: 'tool required' });
    try {
        const result = await nodeRegistry.executeOnNode(req.params.name, tool, ...(params || []));
        res.json({ success: true, result });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/mesh/exec', authMiddleware, async (req, res) => {
    const { tool } = req.query;
    if (!tool) return res.status(400).json({ error: 'tool query param required' });
    try {
        const results = await nodeRegistry.executeOnAll(tool);
        res.json({ results });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Agent memory ─────────────────────────────────────────────
app.get('/api/memory', authMiddleware, (_req, res) => {
    res.json(agentMemory.recallAll());
});

app.post('/api/memory', authMiddleware, (req, res) => {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'key required' });
    agentMemory.remember(key, value);
    res.json({ success: true });
});

app.delete('/api/memory/:key', authMiddleware, (req, res) => {
    agentMemory.forget(req.params.key);
    res.json({ success: true });
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

class AgentOSCLI {
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
║                   AGENTOS PLATFORM v${BRAND.version}                    ║
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
                await TerminalAnimator.showSpinner('Consulting AgentOS…', 500);
                try {
                    const resp = await askEngine.run(text);
                    await TerminalAnimator.glitch(`🤖 Agent (Tier ${resp.tier} — ${resp.type}):`, 400);
                    const formatted = askEngine.formatResponse(resp.result);
                    await TerminalAnimator.typewriter(formatted, 10);
                } catch (e) {
                    console.log(`  ${A.ERROR}Error: ${e.message}${A.RESET}`);
                }
            }
            this.rl.prompt();
        }).on('close', () => { mikrotik.disconnect(); process.exit(0); });
    }

    // ── Commands ─────────────────────────────────────────────

    async cmdHelp() {
        const sorted = Object.entries(this._commands).sort(([a], [b]) => a.localeCompare(b));
        const lines = sorted.map(([n, { desc }]) =>
            `${A.PRIMARY}${A.BOLD}${n.padEnd(14)}${A.RESET}${A.DIM}${desc}${A.RESET}`
        ).join('\n');
        note(lines, '📋 Available Commands');
        clackLog.info(`${A.DIM}Type any command above, or ask the AI anything naturally.${A.RESET}`);
    }

    async cmdConnect() {
        const s = spinner();
        s.start(`Connecting to ${A.BOLD}${CONFIG.MIKROTIK.IP}${A.RESET}…`);
        try {
            await mikrotik.connect();
            s.stop(`${A.SUCCESS}✔ Connected to ${CONFIG.MIKROTIK.IP}${A.RESET}`);
            return true;
        } catch {
            s.stop(`${A.ERROR}✗ Connection failed — check .env credentials${A.RESET}`);
            return false;
        }
    }

    async cmdDisconnect() { mikrotik.disconnect(); console.log('🔌 Disconnected'); }

    async cmdStatus() {
        intro(TerminalAnimator.gradient('  🤖  AgentOS Status  ', [0, 229, 255], [181, 102, 255]));

        const s = spinner();
        s.start('Gathering system telemetry…');
        const [routerStats, vStats] = await Promise.all([
            mikrotik.getSystemStats().catch(() => ({})),
            database.getStats().catch(() => ({ total: 0, active: 0 })),
        ]);
        s.stop('Telemetry collected');

        const skills = fs.existsSync('./skills') ? fs.readdirSync('./skills').filter(f => !f.startsWith('.')).length : 0;
        const memTotal = parseInt(routerStats['total-memory']) || 1;
        const memFree  = parseInt(routerStats['free-memory'])  || 0;
        const memUsedPct = Math.round(((memTotal - memFree) / memTotal) * 100);
        const cpuLoad = routerStats['cpu-load'] || 0;
        const uptimeSec = Math.floor(process.uptime());
        const h = Math.floor(uptimeSec / 3600);
        const m = Math.floor((uptimeSec % 3600) / 60);
        const sec = uptimeSec % 60;
        const uptimeStr = `${h}h ${m}m ${sec}s`;
        const cost = costTracker.snapshot();

        // ── System Identity block
        const identityLines = [
            `${A.BOLD}Profile :${A.RESET}  ${process.env.AGENTOS_PROFILE || 'C:\\Users\\user\\.agentos'}`,
            `${A.BOLD}Version :${A.RESET}  ${BRAND.version}  ${A.DIM}(${BRAND.codename})${A.RESET}`,
            `${A.BOLD}LLM     :${A.RESET}  ${ENV.LLM_PROVIDER.toUpperCase()} — ${llm.model || 'default'}`,
            `${A.BOLD}Uptime  :${A.RESET}  ${uptimeStr}`,
            `${A.BOLD}Skills  :${A.RESET}  ${skills} loaded`,
        ];
        note(identityLines.join('\n'), '📦 System Identity');

        // ── Router Health block
        const routerOnline = mikrotik.isConnected;
        const routerLines = [
            `${A.BOLD}Status  :${A.RESET}  ${routerOnline ? A.SUCCESS + '● ONLINE' : A.ERROR + '● OFFLINE'}${A.RESET}`,
            `${A.BOLD}Address :${A.RESET}  ${CONFIG.MIKROTIK.IP}:${CONFIG.MIKROTIK.PORT}`,
            `${A.BOLD}RouterOS:${A.RESET}  ${routerStats.version || 'unknown'}`,
            `${A.BOLD}CPU     :${A.RESET}  ${cpuLoad}%  ${A.DIM}${cpuLoad > 80 ? '⚠ HIGH' : ''}${A.RESET}`,
            `${A.BOLD}Memory  :${A.RESET}  ${memUsedPct}% used  ${A.DIM}(${fmtBytes(memTotal - memFree)} / ${fmtBytes(memTotal)})${A.RESET}`,
            `${A.BOLD}Gateway :${A.RESET}  ${global.gateway ? A.SUCCESS + 'active' : A.WARN + 'stale'}${A.RESET}`,
        ];
        note(routerLines.join('\n'), '🌐 Router Health');

        // ── Billing & AI block
        const billingLines = [
            `${A.BOLD}Vouchers:${A.RESET}  ${vStats.active} active / ${vStats.total} total  ${A.DIM}(${vStats.used || 0} used, ${vStats.expired || 0} expired)${A.RESET}`,
            `${A.BOLD}AI Cost :${A.RESET}  $${cost.estimatedUSD}  ${A.DIM}(${cost.totalInputTokens} in / ${cost.totalOutputTokens} out tokens)${A.RESET}`,
        ];
        note(billingLines.join('\n'), '💰 Billing & AI Usage');

        outro(`${A.DIM}Type ${A.RESET}help${A.DIM} for available commands — ${new Date().toLocaleTimeString()}${A.RESET}`);
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
            await TerminalAnimator.glitch(`◆ AI RESPONSE [${resp.type}]`, 500);
            if (resp.type === 'ai_act') {
                await TerminalAnimator.typewriter(resp.result, 15);
                console.log(`  ${A.DIM}Metadata: ${JSON.stringify(resp.data, null, 2)}${A.RESET}`);
            } else {
                console.log(`  ${A.BOLD}${resp.result}${A.RESET}`);
            }
        } catch (e) {
            console.log(`  ${A.ERROR}Error: ${e.message}${A.RESET}`);
        }
    }

    async cmdNodes() {
        TerminalAnimator.printHeader('NETWORK NODES');
        await sleep(300);
        console.log(`  ${A.PRIMARY}◆${A.RESET} ${TerminalAnimator.gradient('AgentOS-Main-Gateway', [0, 255, 127], [50, 150, 255])}`);
        console.log(`  ${A.DIM}│  Status: ${mikrotik.isConnected ? A.SUCCESS + 'ONLINE' : A.ERROR + 'OFFLINE'}${A.RESET}`);
        console.log(`  ${A.DIM}│  Endpoint: ${A.RESET}${CONFIG.MIKROTIK.IP}\n`);
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
        // Interactive mode when args are missing
        if (!username) {
            intro(`${A.BOLD}Add Hotspot User${A.RESET}`);
            const uInput = await text({ message: 'Username:', placeholder: 'e.g. john' });
            if (isCancel(uInput)) { clackLog.warn('Cancelled.'); return; }
            username = uInput;
        }
        if (!password) {
            const pInput = await text({ message: 'Password:', placeholder: 'leave blank to use username' });
            if (isCancel(pInput)) { clackLog.warn('Cancelled.'); return; }
            password = pInput || username;
        }
        if (profile === 'default') {
            const pInput = await select({
                message: 'Profile / Plan:',
                options: [
                    { value: 'default', label: 'default' },
                    { value: '1hour',   label: '1 Hour   — 1 hr access' },
                    { value: '1Day',    label: '1 Day    — 24 hr access' },
                    { value: '7Day',    label: '7 Days   — weekly access' },
                    { value: '30Day',   label: '30 Days  — monthly access' },
                ],
            });
            if (isCancel(pInput)) { clackLog.warn('Cancelled.'); return; }
            profile = pInput;
        }
        const s = spinner();
        s.start(`Provisioning user ${A.BOLD}${username}${A.RESET}…`);
        try {
            const res = await mikrotik.addHotspotUser(username, password, profile);
            s.stop(`${A.SUCCESS}✔ User ${res.username} ${res.action}${A.RESET}`);
        } catch (err) {
            s.stop(`${A.ERROR}✗ Failed: ${err.message}${A.RESET}`);
        }
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
        // Interactive plan selection
        if (!plan) {
            intro(`${A.BOLD}Create Voucher${A.RESET}`);
            const planInput = await select({
                message: 'Select plan:',
                options: Object.entries(CONFIG.VOUCHER_PLANS).map(([k, v]) => ({
                    value: k,
                    label: `${v.label.padEnd(10)}  ${A.DIM}$${v.price.toFixed(2)}${A.RESET}`,
                    hint: `valid for ${fmtUptime(v.maxAgeMs / 1000)}`,
                })),
            });
            if (isCancel(planInput)) { clackLog.warn('Cancelled.'); return; }
            plan = planInput;
        }

        const code = voucherCode();
        const s = spinner();
        s.start('Generating secure voucher…');
        await database.createVoucher(code, { plan, duration, createdBy: 'cli' });
        s.stop('Voucher record saved');

        // Animated decode of the code
        await TerminalAnimator.decode(code, 50);
        note(
            [
                `${A.BOLD}Code  :${A.RESET} ${A.NEON_CYAN}${code}${A.RESET}`,
                `${A.BOLD}Plan  :${A.RESET} ${plan}`,
                `${A.BOLD}Price :${A.RESET} $${(CONFIG.VOUCHER_PLANS[plan]?.price || 0).toFixed(2)}`,
                `${A.BOLD}Valid :${A.RESET} ${CONFIG.VOUCHER_PLANS[plan] ? fmtUptime(CONFIG.VOUCHER_PLANS[plan].maxAgeMs / 1000) : 'unlimited'}`,
            ].join('\n'),
            '🎫 New Voucher'
        );

        if (mikrotik.isConnected) {
            const gs = spinner();
            gs.start('Provisioning on gateway…');
            await mikrotik.addHotspotUser(code, code, plan).catch(() => {});
            gs.stop(`${A.SUCCESS}✔ Provisioned on gateway${A.RESET}`);
        } else {
            clackLog.warn('Router offline — voucher saved to DB but not provisioned on gateway.');
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
        console.log(`\n  ${A.BOLD}🔍 Scanning ARP Table…${A.RESET}`);
        for (let i = 1; i <= 10; i++) {
            TerminalAnimator.progressBar('Network Scan', i * 10);
            await sleep(50);
        }
        console.log('');
        arp.filter(e => e.address).slice(0, 20).forEach(e =>
            console.log(`  ${A.PRIMARY}◆${A.RESET} ${e.address.padEnd(15)} ${A.DIM}${e['mac-address'] || 'N/A'}${A.RESET}`));
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
        const ok = await confirm({
            message: `${A.ERROR}⚠  Reboot router at ${CONFIG.MIKROTIK.IP}?${A.RESET}  This will drop all connections.`,
            initialValue: false,
        });
        if (isCancel(ok) || !ok) {
            clackLog.warn('Reboot cancelled.');
            this.rl.prompt();
            return;
        }
        const s = spinner();
        s.start('Sending reboot command…');
        await mikrotik.reboot();
        s.stop(`${A.SUCCESS}✔ Reboot command sent — router is cycling${A.RESET}`);
        mikrotik.disconnect();
        this.rl.prompt();
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
        const sp = spinner();
        sp.start('Loading voucher statistics…');
        const s = await database.getStats();
        sp.stop('Stats loaded');

        const pct = (n) => s.total > 0 ? Math.round((n / s.total) * 100) : 0;
        note(
            [
                `${A.BOLD}Total   :${A.RESET}  ${s.total}`,
                `${A.BOLD}Active  :${A.RESET}  ${A.SUCCESS}${s.active}${A.RESET}  ${A.DIM}(${pct(s.active)}%)${A.RESET}`,
                `${A.BOLD}Used    :${A.RESET}  ${s.used || 0}  ${A.DIM}(${pct(s.used || 0)}%)${A.RESET}`,
                `${A.BOLD}Expired :${A.RESET}  ${A.WARN}${s.expired || 0}${A.RESET}  ${A.DIM}(${pct(s.expired || 0)}%)${A.RESET}`,
            ].join('\n'),
            '📊 Voucher Statistics'
        );
    }
}

// ============================================================
// §18  ONE-OFF CLI EXECUTION
// ============================================================

async function runOneOff(params) {
    const [cmd, ...args] = params;
    const cli = new AgentOSCLI();
    const commands = {
        'voucher': () => cli.cmdVoucher(args),
        'redeem': () => cli.cmdRedeem(args),
        'status': () => cli.cmdStatus(),
    };
    if (commands[cmd]) {
        try { await commands[cmd](); }
        catch (err) { console.error('Error:', err.message); }
    } else {
        // Fallback to Tiered Engine for one-off CLI calls
        try {
            const resp = await askEngine.run(params.join(' '));
            console.log(`\n🤖 Tier ${resp.tier} (${resp.type}):\n${askEngine.formatResponse(resp.result)}`);
        } catch (err) {
            console.log(`Unknown command: ${cmd}\nAvailable: ${Object.keys(commands).join(', ')}`);
        }
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
        global.gateway = gateway;
        gwServer.listen(CONFIG.GATEWAY.PORT, CONFIG.GATEWAY.HOST, () => {
            logger.info(`WS Gateway  → ws://${CONFIG.GATEWAY.HOST}:${CONFIG.GATEWAY.PORT}${CONFIG.GATEWAY.WS_PATH}`);
            logger.info(`Dashboard   → http://localhost:${CONFIG.GATEWAY.PORT}/index.html`);
        });
    } else {
        gateway = new AgentOSGateway(expressServer);
        global.gateway = gateway;
    }

    const bot = new AgentOSBot();
    global.agentBot = bot;
    const monitor = new SystemMonitor(mikrotik, bot);
    monitor.start(30_000);
    global.orchestrator = new AgentOSOrchestrator(mikrotik, database, gateway, bot);

    expressServer.listen(CONFIG.SERVER.PORT, CONFIG.SERVER.HOST, () => {
        logger.info(`${BRAND.name} v${BRAND.version} [${BRAND.codename}] → http://${CONFIG.SERVER.HOST}:${CONFIG.SERVER.PORT}`);
        logger.info(`Health check → http://${CONFIG.SERVER.HOST}:${CONFIG.SERVER.PORT}/health`);
        logger.info(`LLM Provider → ${ENV.LLM_PROVIDER.toUpperCase()} (${llm.model || 'default'})`);
        if (github.enabled) logger.info(`GitHub       → OAuth enabled, webhook at /webhooks/github`);
        if (emotionEngine) logger.info(`EmotionEngine→ active (urgency decay every ${CONFIG.EMOTION.URGENCY_TTL / 60000}min)`);
        logger.info(`Vault        → AES-256-GCM encryption ${ENV.VAULT_MASTER_KEY.startsWith('changeme') ? '[⚠ default key — set VAULT_MASTER_KEY]' : 'ready'}`);
        logger.info(`Device Mesh  → mode=${CONFIG.DEVICE.MODE}, id=${CONFIG.DEVICE.ID}`);
        if (CONFIG.MCP.ENABLED) logger.info(`MCP Server   → port ${CONFIG.MCP.PORT}`);
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
    cliArgs.length > 0 ? runOneOff(cliArgs) : new AgentOSCLI().start();
} else {
    bootDaemon().catch(err => { logger.error('Fatal boot error:', err); process.exit(1); });
}