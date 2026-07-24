'use strict';
const https = require('https');
const { URL } = require('url');

/** Minimal JSON-over-HTTPS helper shared by courier providers — no extra dependency. */
function jsonRequest(url, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const data = body ? JSON.stringify(body) : null;
        const req = https.request(u, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
                ...headers,
            },
        }, (res) => {
            let chunks = '';
            res.on('data', (c) => { chunks += c; });
            res.on('end', () => {
                let parsed = null;
                try { parsed = chunks ? JSON.parse(chunks) : {}; } catch { parsed = { raw: chunks }; }
                if (res.statusCode >= 400) {
                    return reject(new Error(parsed?.message || parsed?.error || `Request failed (${res.statusCode})`));
                }
                resolve(parsed);
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

module.exports = { jsonRequest };
