import fs from 'fs';
import path from 'path';
import http from 'http';
import { logger } from '../../core/logger.js';
import readline from 'readline';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// ==========================================
// AGENTOS ASK COMMAND
// Query AskEngine from the CLI — proxies to a running gateway over
// HTTP when one is up (fast, reuses live router/db connections),
// falls back to a standalone one-shot AskEngine otherwise.
// ==========================================

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
            // 90s, not 30s: dahua.events.summarize chains a device log search (occasionally
            // 20-30s on a slow/busy NVR) with an actual AI call on top — 30s cut it too close
            // and produced a silent timeout with no error surfaced in time to matter.
            timeout: 90_000
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

    // Propagate API key from config into env so LLMCoordinator providers can pick it up
    if (config.ai?.key && !process.env.GEMINI_API_KEY) {
        process.env.GEMINI_API_KEY = config.ai.key;
    }

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

function startRepl(dispatch, { json }) {
    console.log('AgentOS interactive ask — type a message and press Enter. Ctrl+C or "exit" to quit.\n');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '› ' });
    rl.prompt();

    rl.on('line', async (line) => {
        const prompt = line.trim();
        if (!prompt) { rl.prompt(); return; }
        if (['exit', 'quit', ':q'].includes(prompt.toLowerCase())) { rl.close(); return; }

        try {
            const result = await dispatch(prompt);
            if (json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.log(typeof result?.result === 'string' ? result.result : JSON.stringify(result?.result, null, 2));
            }
        } catch (err) {
            console.error(`error: ${err.message}`);
        }
        console.log('');
        rl.prompt();
    });

    rl.on('close', () => {
        console.log('\nGoodbye.');
        process.exit(0);
    });
}

export default (program) => {
    program
        .command('ask [prompt...]')
        .description('Ask AgentOS a question or give it a command. Omit the prompt to start an interactive session.')
        .option('--stream', 'Stream the response token-by-token (standalone mode only)')
        .option('--json', 'Print the full raw response as JSON')
        .option('--port <port>', 'Gateway port to target', (v) => parseInt(v, 10))
        .action(async (promptParts, options) => {
            const prompt = (promptParts || []).join(' ');

            const { STATE_PATH, CONFIG_PATH } = global.AGENTOS || {};
            let config = {};
            try {
                if (CONFIG_PATH && fs.existsSync(CONFIG_PATH)) {
                    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
                }
            } catch (_) { /* fall through to standalone */ }

            const port = options.port || config.gateway?.port || 19876;
            const usingGateway = STATE_PATH && gatewayIsRunning(STATE_PATH);

            const dispatch = (p) => usingGateway
                ? postJSON({ host: config.gateway?.host, port, token: config.gateway?.token }, { prompt: p, stream: false })
                : runStandalone(p, { stream: false });

            if (!prompt.trim()) {
                if (!process.stdin.isTTY) {
                    console.error('Usage: agentos ask "<your question or command>" (or run with no args in an interactive terminal)');
                    process.exitCode = 1;
                    return;
                }
                return startRepl(dispatch, { json: !!options.json });
            }

            try {
                if (usingGateway) {
                    if (options.stream) {
                        console.error('--stream is only supported in standalone mode (no gateway running); printing full response instead.');
                    }
                    const result = await dispatch(prompt);
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
