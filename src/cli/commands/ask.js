'use strict';
// ==========================================
// AGENTOS ASK COMMAND
// Query AskEngine from the CLI — proxies to a running gateway over
// HTTP when one is up (fast, reuses live router/db connections),
// falls back to a standalone one-shot AskEngine otherwise.
// ==========================================

const fs = require('fs');
const path = require('path');
const http = require('http');

const { logger } = require('../../core/logger');

function postJSON({ host, port, token }, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = http.request({
            host: host || '127.0.0.1',
            port,
            path: '/api/v1/ask',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            timeout: 30_000
        }, (res) => {
            let chunks = '';
            res.on('data', (c) => { chunks += c; });
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    return reject(new Error(`Gateway responded ${res.statusCode}: ${chunks}`));
                }
                try { resolve(JSON.parse(chunks)); }
                catch (e) { reject(new Error(`Bad JSON from gateway: ${e.message}`)); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('Gateway request timed out')));
        req.write(data);
        req.end();
    });
}

function gatewayIsRunning(stateDir) {
    const pidFile = path.join(stateDir, 'gateway.pid');
    if (!fs.existsSync(pidFile)) return false;
    try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        process.kill(pid, 0); // throws if not running
        return true;
    } catch {
        return false;
    }
}

/** Standalone, gateway-less one-shot AskEngine — used when no gateway is running. */
async function runStandalone(prompt, { stream }) {
    const { getManager: getMikroTik } = require('../../core/mikrotik');
    const { getDatabase } = require('../../core/database');
    const { getConfig } = require('../../core/config');
    const FinancialService = require('../../core/financial');
    const UniversalBilling = require('../../core/universal-billing');
    const DiscoveryService = require('../../core/discovery');
    const MemoryManager = require('../../core/memory/MemoryManager');
    const AskEngine = require('../../core/ask-engine');
    const LLMCoordinator = require('../../core/llm/LLMCoordinator');

    const config = getConfig();
    const mikrotik = getMikroTik();
    const database = await getDatabase();
    const financial = new FinancialService({ database });
    const billing = new UniversalBilling({ database });
    const discovery = new DiscoveryService({ mikrotik });
    const memoryManager = new MemoryManager(config.memory?.adapter || 'memory');
    await memoryManager.initialize();

    let llmCoordinator = null;
    try {
        llmCoordinator = new LLMCoordinator();
    } catch (err) {
        logger.warn(`LLMCoordinator not initialized: ${err.message}. Running rule-only.`);
    }

    const askEngine = new AskEngine({
        mikrotik,
        database,
        financial,
        billing,
        discovery,
        memory: memoryManager,
        llm: llmCoordinator
    });

    if (stream) {
        for await (const ev of askEngine.stream(prompt)) {
            if (ev.type === 'text' && ev.delta) process.stdout.write(ev.delta);
            else if (ev.type === 'error') process.stderr.write(`\n[error] ${ev.message}\n`);
        }
        process.stdout.write('\n');
        return null;
    }

    return askEngine.run(prompt);
}

module.exports = (program) => {
    program
        .command('ask <prompt...>')
        .description('Ask AgentOS a question or give it a command (uses the running gateway if up, else one-shot)')
        .option('--stream', 'Stream the response token-by-token')
        .option('--json', 'Print the full raw response as JSON')
        .option('--port <port>', 'Gateway port to target', (v) => parseInt(v, 10))
        .action(async (promptParts, options) => {
            const prompt = promptParts.join(' ');
            if (!prompt.trim()) {
                console.error('Usage: agentos ask "<your question or command>"');
                process.exitCode = 1;
                return;
            }

            const { STATE_PATH, CONFIG_PATH } = global.AGENTOS || {};
            let config = {};
            try {
                if (CONFIG_PATH && fs.existsSync(CONFIG_PATH)) {
                    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
                }
            } catch (_) { /* fall through to standalone */ }

            const port = options.port || config.gateway?.port || 19876;
            const usingGateway = STATE_PATH && gatewayIsRunning(STATE_PATH);

            try {
                if (usingGateway) {
                    if (options.stream) {
                        console.error('--stream is only supported in standalone mode (no gateway running); printing full response instead.');
                    }
                    const result = await postJSON(
                        { host: config.gateway?.host, port, token: config.gateway?.token },
                        { prompt, stream: false }
                    );
                    if (options.json) {
                        console.log(JSON.stringify(result, null, 2));
                    } else {
                        console.log(typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2));
                    }
                } else {
                    const result = await runStandalone(prompt, { stream: !!options.stream });
                    if (result) {
                        if (options.json) {
                            console.log(JSON.stringify(result, null, 2));
                        } else {
                            console.log(typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2));
                        }
                    }
                }
            } catch (err) {
                console.error(`ask failed: ${err.message}`);
                process.exitCode = 1;
            }
        });
};
