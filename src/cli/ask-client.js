import http from 'node:http';

export function createAskClient({ host = '127.0.0.1', port = 19876, token } = {}) {
    return {
        async run(prompt, { signal, stream = false, resourceType, resourceId } = {}) {
            const body = JSON.stringify({ prompt, stream, ...(resourceType ? { resourceType } : {}), ...(resourceId ? { resourceId } : {}) });
            return new Promise((resolve, reject) => {
                const headers = {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    'X-AgentOS-Client': 'cli',
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                };
                const req = http.request({ host, port, path: '/api/v1/ask', method: 'POST', headers, timeout: 90_000 }, (res) => {
                    let chunks = '';
                    res.setEncoding('utf8');
                    res.on('data', (chunk) => { chunks += chunk; });
                    res.on('end', () => {
                        if (res.statusCode >= 400) return reject(new Error(`Gateway responded ${res.statusCode}: ${chunks}`));
                        try { resolve(JSON.parse(chunks)); } catch (error) { reject(new Error(`Bad JSON from gateway: ${error.message}`)); }
                    });
                });
                req.on('error', reject);
                req.on('timeout', () => req.destroy(new Error('Gateway request timed out')));
                if (signal) {
                    if (signal.aborted) return req.destroy(signal.reason || new Error('Operation cancelled by user'));
                    signal.addEventListener('abort', () => req.destroy(signal.reason || new Error('Operation cancelled by user')), { once: true });
                }
                req.end(body);
            });
        }
    };
}