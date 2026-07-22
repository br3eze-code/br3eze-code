#!/usr/bin/env node
// ============================================================
// AgentOS — Network Intelligence Platform (Modular Entry Point)
// Version : 2026.5.0
// ============================================================
process.env.GRPC_DNS_RESOLVER = 'native';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Joi = require('joi');
require('dotenv').config();

// ── AgentOS Modular Core ─────────────────────────────────────
const { logger } = require('./src/core/logger');
const { metrics } = require('./src/core/metrics');
const { costTracker } = require('./src/core/cost-tracker');
const { getDatabase } = require('./src/core/database');
const FinancialController = require('./src/core/financial');
const agentMemoryInstance = require('./src/core/agent-memory');
const nodeRegistryInstance = require('./src/core/node-registry');
const SkillRegistry = require('./src/core/SkillRegistry');
const { getManager } = require('./src/core/mikrotik');
const AskEngine = require('./src/core/ask-engine');
const AgentOSOrchestrator = require('./src/core/orchestrator');
const { WebSocketGateway: AgentOSGateway } = require('./src/core/websocket');
const TelegramChannel = require('./src/core/channels/TelegramChannel');
const { A, TerminalAnimator } = require('./src/core/terminal-animator');
const { AgentOSCLI, runOneOff } = require('./src/core/cli');
const { createRouter } = require('./src/core/routes');

// Inject singletons into global namespace for bootstrap compatibility
global.database = getDatabase();
global.financial = new FinancialController();
global.agentMemory = agentMemoryInstance;
global.nodeRegistry = nodeRegistryInstance;
global.skills = new SkillRegistry();
global.mikrotik = getManager();

const LLMCoordinator = require('./src/core/llm/LLMCoordinator');
const llm = new LLMCoordinator(process.env.LLM_PROVIDER || 'gemini');

global.askEngine = new AskEngine({
    mikrotik: global.mikrotik,
    database: global.database,
    financial: global.financial,
    memory: global.agentMemory,
    llm: llm
});
global.metrics = metrics;
global.costTracker = costTracker;
global.AgentOSBot = TelegramChannel;
global.AgentOSGateway = AgentOSGateway;
global.AgentOSOrchestrator = AgentOSOrchestrator;

// ============================================================
// §1  CONSTANTS & CONFIG
// ============================================================

const BRAND = {
    name: 'AgentOS',
    version: '2026.5.0',
    emoji: '🤖',
    tagline: 'Network Intelligence, Simplified',
};

const envSchema = Joi.object({
    MIKROTIK_PASS: Joi.string().required(),
    TELEGRAM_TOKEN: Joi.string().allow('').default(''),
    MIKROTIK_IP: Joi.string().default('192.168.88.1'),
    PORT: Joi.number().default(3000),
    GATEWAY_PORT: Joi.number().default(19876),
    AGENTOS_GATEWAY_TOKEN: Joi.string().allow('').default(''),
}).unknown(true);

const { error: envError, value: ENV } = envSchema.validate(process.env);
if (envError) { console.error(`[AgentOS] ENV error: ${envError.message}`); process.exit(1); }

const CONFIG = {
    MIKROTIK: { IP: ENV.MIKROTIK_IP, PASS: ENV.MIKROTIK_PASS },
    TELEGRAM: { TOKEN: ENV.TELEGRAM_TOKEN },
    GATEWAY: {
        PORT: ENV.GATEWAY_PORT,
        HOST: ENV.GATEWAY_HOST || '127.0.0.1',
        TOKEN: ENV.AGENTOS_GATEWAY_TOKEN || crypto.randomBytes(32).toString('hex'),
        WS_PATH: '/ws',
    },
    SERVER: { PORT: ENV.PORT, HOST: ENV.HOST || '0.0.0.0' },
    VOUCHER_PREFIX: 'STAR-',
};

// ============================================================
// §2  DAEMON BOOTSTRAP
// ============================================================

async function bootDaemon() {
    try { await mikrotik.connect(); }
    catch (err) { logger.warn(`Starting in limited mode — MikroTik unreachable: ${err.message}`); }

    const app = express();
    app.set('trust proxy', 1);
    app.use(helmet());
    app.use(cors({ origin: '*' }));
    app.use(express.json({ limit: '10mb' }));
    app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
    app.use((req, res, next) => { metrics.requests++; next(); });
    app.use(express.static('public'));

    // Inject Routes
    const deps = { mikrotik, database, askEngine, financial, nodeRegistry, agentMemory, config: CONFIG, brand: BRAND };
    app.use('/', createRouter(deps));
    app.get('/', (req, res) => res.redirect('/index.html'));

    const expressServer = http.createServer(app);

    // Gateway setup
    let gateway;
    if (CONFIG.GATEWAY.PORT !== CONFIG.SERVER.PORT) {
        const gwServer = http.createServer((req, res) => {
            if (req.url === '/api/token') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ token: CONFIG.GATEWAY.TOKEN, wsPort: CONFIG.GATEWAY.PORT, apiPort: CONFIG.SERVER.PORT }));
                return;
            }
            res.writeHead(404); res.end();
        });
        gateway = new AgentOSGateway(gwServer);
        gwServer.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                logger.warn(`Gateway port ${CONFIG.GATEWAY.PORT} already in use — attaching WS to express server instead.`);
                // Re-attach gateway to the express server as fallback
                gateway = new AgentOSGateway(expressServer);
                global.gateway = gateway;
            } else {
                logger.error('Gateway server error:', err);
            }
        });
        gwServer.listen(CONFIG.GATEWAY.PORT, CONFIG.GATEWAY.HOST);
    } else {
        gateway = new AgentOSGateway(expressServer);
    }
    global.gateway = gateway;

    const bot = new TelegramChannel({ token: CONFIG.TELEGRAM.TOKEN }, { mikrotik, database, askEngine, skills, memory: agentMemory, nodeRegistry, financial });
    global.agentBot = bot;
    bot.initialize().catch(err => logger.error('Telegram bot init failed:', err));

    const orchestrator = new AgentOSOrchestrator(mikrotik, database, gateway, bot);
    global.orchestrator = orchestrator;
    orchestrator.start();

    expressServer.listen(CONFIG.SERVER.PORT, CONFIG.SERVER.HOST, () => {
        logger.info(`${BRAND.name} v${BRAND.version} → http://${CONFIG.SERVER.HOST}:${CONFIG.SERVER.PORT}`);
    });

    const shutdown = (sig) => {
        logger.info(`${sig} received — shutting down gracefully`);
        if (typeof gateway.closeAll === 'function') gateway.closeAll();
        else if (typeof gateway.close === 'function') gateway.close();
        mikrotik.disconnect();
        expressServer.close(() => process.exit(0));
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

// ============================================================
// §3  ENTRY POINT
// ============================================================

const ARGS = process.argv.slice(2);
const IS_CLI = ARGS[0] === 'cli';

if (IS_CLI) {
    const deps = { config: CONFIG, brand: BRAND, mikrotik, database, askEngine };
    const cliArgs = ARGS.slice(1);
    cliArgs.length > 0 ? runOneOff(cliArgs, deps) : new AgentOSCLI(deps).start();
} else {
    bootDaemon().catch(err => { logger.error('Fatal boot error:', err); process.exit(1); });
}