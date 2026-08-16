import http from 'node:http';
import https from 'node:https';

class GrpcTransport {
    constructor(mTLSConfig = {}, options = {}) {
        this.mTLSConfig = mTLSConfig;
        this.agentEndpoints = new Map();
        this.timeoutMs = Number(options.timeoutMs || mTLSConfig.timeoutMs || 15000);
        this.maxRetries = Number(options.maxRetries ?? mTLSConfig.maxRetries ?? 2);
    }

    async initialize() {}

    registerEndpoint(spiffeID, endpoint) {
        const parsed = new URL(endpoint);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`Unsupported A2A endpoint protocol: ${parsed.protocol}`);
        this.agentEndpoints.set(spiffeID, parsed.toString().replace(/\/$/, ''));
    }

    _pathFor(message, endpoint) {
        const base = new URL(endpoint).pathname.replace(/\/$/, '');
        return `${base || ''}/a2a/${encodeURIComponent(message.recipient.split('/').pop())}`;
    }

    async send(message, targetSPIFFE) {
        const endpoint = this.agentEndpoints.get(targetSPIFFE);
        if (!endpoint) throw new Error(`No endpoint registered for agent ${targetSPIFFE}. Call registerEndpoint first.`);
        let attempt = 0;
        while (true) {
            try {
                return await this._sendOnce(message, endpoint);
            } catch (error) {
                if (attempt >= this.maxRetries || (error.statusCode && error.statusCode < 500)) throw error;
                await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * (2 ** attempt), 5000)));
                attempt += 1;
            }
        }
    }

    _sendOnce(message, endpoint) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify(message);
            const url = new URL(endpoint);
            const client = url.protocol === 'https:' ? https : http;
            const request = client.request({
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: this._pathFor(message, endpoint),
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                    'A2A-Protocol-Version': message.protocolVersion || '1.0',
                    'X-A2A-Trace-Id': message.traceId || ''
                },
                ...(this.mTLSConfig.agent ? { agent: this.mTLSConfig.agent } : {})
            }, (response) => {
                let body = '';
                response.setEncoding('utf8');
                response.on('data', (chunk) => { body += chunk; });
                response.on('end', () => {
                    let parsed;
                    try { parsed = JSON.parse(body); } catch { reject(new Error(`Invalid A2A JSON response (${response.statusCode})`)); return; }
                    if (response.statusCode < 200 || response.statusCode >= 300) {
                        const error = new Error(parsed.error?.message || `A2A HTTP ${response.statusCode}`);
                        error.statusCode = response.statusCode;
                        error.code = parsed.error?.code || 'REMOTE_ERROR';
                        reject(error);
                        return;
                    }
                    resolve(parsed);
                });
            });
            request.setTimeout(this.timeoutMs, () => request.destroy(new Error(`A2A request timed out after ${this.timeoutMs}ms`)));
            request.on('error', reject);
            request.write(data);
            request.end();
        });
    }
}

export { GrpcTransport };
