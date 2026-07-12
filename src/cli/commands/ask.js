// ==========================================
// AGENTOS ASK COMMAND
// Query AskEngine from the CLI — proxies to a running gateway over
// HTTP when one is up (fast, reuses live router/db connections),
// falls back to a standalone one-shot AskEngine otherwise.
// ==========================================

import fs from 'fs';
import path from 'path';
import http from 'http';

import { logger } from '../../core/logger.js';

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
    import { getManager: getMikroTik } from '../../core/mikrotik.js';
    import { getDatabase } from '../../core/database.js';
    import { getConfig } from '../../core/config.js';
    import FinancialService from '../../core/financial.js';
    import UniversalBilling from '../../core/universal-billing.js';
    import DiscoveryService from '../../core/discovery.js';
    import MemoryManager from '../../core/memory/MemoryManager.js';
    import AskEngine from '../../core/ask-engine.js';
    import LLMCoordinator from '../../core/llm/LLMCoordinator.js';

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

import readline from 'readline';

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

module.exports = (program) => {
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
