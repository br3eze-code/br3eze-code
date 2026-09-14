import fs from 'node:fs';
import path from 'node:path';
import { createAskClient } from '../ask-client.js';
import { createAbortController, createQueuedRepl } from '../terminal-session.js';
import { renderAgentResult } from '../terminal-renderer.js';

function gatewayIsRunning(stateDir) {
    const pidFile = path.join(stateDir, 'gateway.pid');
    if (!fs.existsSync(pidFile)) return false;
    try {
        const pid = Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function startRepl(dispatch, { json }) {
    console.log('AgentOS interactive ask — Enter submits, Ctrl+C cancels, /back returns, /exit quits.\n');
    return createQueuedRepl({ dispatch, json, renderResult: (result, options) => renderAgentResult(result, options) });
}

export default (program) => {
    program
        .command('ask [prompt...]')
        .description('Ask AgentOS a question or give it a command. Omit the prompt to start an interactive session.')
        .option('--stream', 'Request a streamed response from the gateway')
        .option('--json', 'Print the full raw response as JSON')
        .option('--port <port>', 'Gateway port to target', (v) => Number.parseInt(v, 10))
        .action(async (promptParts, options) => {
            const prompt = (promptParts || []).join(' ').trim();
            const { STATE_PATH, CONFIG_PATH } = global.AGENTOS || {};
            let config = {};
            try {
                if (CONFIG_PATH && fs.existsSync(CONFIG_PATH)) config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            } catch (_) { /* use defaults */ }

            const port = options.port || config.gateway?.port || 19876;
            const host = config.gateway?.host || '127.0.0.1';
            if (!STATE_PATH || !gatewayIsRunning(STATE_PATH)) {
                console.error(`AgentOS gateway is not running on ${host}:${port}. Start the gateway before using 'agentos ask'.`);
                process.exitCode = 1;
                return;
            }

            const client = createAskClient({ host, port, token: config.gateway?.token });
            const dispatch = (text, { signal } = {}) => client.run(text, { signal, stream: !!options.stream });

            if (!prompt) {
                if (!process.stdin.isTTY) {
                    console.error('Usage: agentos ask "<your question or command>" (or run with no args in an interactive terminal)');
                    process.exitCode = 1;
                    return;
                }
                return startRepl(dispatch, { json: !!options.json });
            }

            const controller = createAbortController();
            try {
                const result = await dispatch(prompt, { signal: controller.signal });
                renderAgentResult(result, { json: !!options.json });
            } catch (error) {
                const cancelled = controller.signal.aborted || /cancelled/i.test(error?.message || '');
                console.error(cancelled ? 'ask cancelled' : `ask failed: ${error.message}`);
                process.exitCode = 1;
            } finally {
                controller.dispose();
            }
        });
};
