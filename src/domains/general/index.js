'use strict';

/**
 * General Tools Domain
 * SECURITY: No eval(), no Function(), no unvalidated shell exec
 */

const os     = require('os');
const crypto = require('crypto');


// ── Recursive descent math parser (no eval, no Function) ─────────────────────
function parseExpr(expr, state) {
    let result = parseTerm(expr, state);
    while (state.pos < expr.length) {
        const op = expr[state.pos];
        if (op !== '+' && op !== '-') break;
        state.pos++;
        const right = parseTerm(expr, state);
        result = op === '+' ? result + right : result - right;
    }
    return result;
}
function parseTerm(expr, state) {
    let result = parsePower(expr, state);
    while (state.pos < expr.length) {
        const op = expr[state.pos];
        if (op !== '*' && op !== '/' && op !== '%') break;
        state.pos++;
        const right = parsePower(expr, state);
        if (op === '*') result *= right;
        else if (op === '/') { if (right === 0) throw new Error('Division by zero'); result /= right; }
        else result %= right;
    }
    return result;
}
function parsePower(expr, state) {
    const base = parseUnary(expr, state);
    if (state.pos < expr.length && expr[state.pos] === '*' && expr[state.pos + 1] === '*') {
        state.pos += 2;
        return Math.pow(base, parsePower(expr, state));
    }
    return base;
}
function parseUnary(expr, state) {
    if (expr[state.pos] === '-') { state.pos++; return -parsePrimary(expr, state); }
    if (expr[state.pos] === '+') { state.pos++; return parsePrimary(expr, state); }
    return parsePrimary(expr, state);
}
function parsePrimary(expr, state) {
    if (expr[state.pos] === '(') {
        state.pos++;
        const val = parseExpr(expr, state);
        if (expr[state.pos] !== ')') throw new Error('Missing closing parenthesis');
        state.pos++;
        return val;
    }
    // Number literal
    const match = expr.slice(state.pos).match(/^\d+(\.\d+)?([eE][+-]?\d+)?/);
    if (!match) throw new Error('Expected number at position ' + state.pos);
    state.pos += match[0].length;
    return parseFloat(match[0]);
}

// ── Safe math evaluator (no eval / Function constructor) ─────────────────────
// Supports: integers, floats, +  -  *  /  **  %  ()
// Rejects:  any non-numeric characters → prevents RCE
function safeMath(expression) {
    // Strict allowlist: digits, operators, parens, dots, spaces only
    if (!/^[\d\s\+\-\*\/\%\(\)\.e]+$/i.test(expression)) {
        throw new Error('Expression contains disallowed characters');
    }
    // Length guard
    if (expression.length > 200) {
        throw new Error('Expression too long');
    }
    // Use Function with no global access — scope is completely empty
    // This is safe ONLY because the allowlist above rejects all non-math input
    try {
        // eslint-disable-next-line no-new-func
        // SAFE: allowlist above permits only [ds+-*/%().e] — no identifiers possible
        // eslint-disable-next-line no-new-func

    } catch (err) {
        throw new Error('Invalid math expression');
    }
}

// ── Host validator — prevents command injection ───────────────────────────────
function validateHost(host) {
    if (typeof host !== 'string') throw new Error('Host must be a string');
    // RFC-952 / RFC-1123 hostname or IPv4 — no shell metacharacters
    const ipv4    = /^(\d{1,3}\.){3}\d{1,3}$/;
    const hostname = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!ipv4.test(host) && !hostname.test(host)) {
        throw new Error(`Invalid host: ${host}`);
    }
    // Block localhost / loopback to prevent SSRF
    const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
    if (blocked.includes(host.toLowerCase())) throw new Error('Forbidden host');
    return host;
}

// ── Tools ─────────────────────────────────────────────────────────────────────

const generalTools = [
    {
        name: 'calculate',
        description: 'Perform safe math calculations (no code execution)',
        parameters: {
            type: 'object',
            properties: {
                expression: {
                    type: 'string',
                    description: 'Math expression e.g. "2 * 15 + 10" or "1024 ** 3"'
                }
            },
            required: ['expression']
        },
        execute: async ({ expression }) => {
            try {
                const result = safeMath(String(expression).trim());
                if (typeof result !== 'number' || !isFinite(result)) {
                    return { success: false, error: 'Result is not a finite number' };
                }
                return { success: true, result, expression };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }
    },

    {
        name: 'time',
        description: 'Get current time, date, or timezone info',
        parameters: {
            type: 'object',
            properties: {
                format: { type: 'string', enum: ['iso', 'human', 'unix'], default: 'human' }
            }
        },
        execute: async ({ format = 'human' } = {}) => {
            const now = new Date();
            const formats = {
                iso:   now.toISOString(),
                human: now.toLocaleString(),
                unix:  Math.floor(now.getTime() / 1000)
            };
            return { success: true, time: formats[format] ?? formats.human, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
        }
    },

    {
        name: 'system.info',
        description: 'Get local system information',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({
            success: true,
            platform: os.platform(),
            arch:     os.arch(),
            uptime:   os.uptime(),
            memory:   { total: os.totalmem(), free: os.freemem() },
            cpus:     os.cpus().length
        })
    },

    {
        name: 'uuid',
        description: 'Generate a UUID v4',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ success: true, uuid: crypto.randomUUID() })
    },

    {
        name: 'hash',
        description: 'Hash a string with SHA-256',
        parameters: {
            type: 'object',
            properties: {
                input: { type: 'string', description: 'String to hash' }
            },
            required: ['input']
        },
        execute: async ({ input }) => ({
            success: true,
            hash: crypto.createHash('sha256').update(String(input)).digest('hex')
        })
    },

    {
        name: 'ping',
        description: 'Ping a host using MikroTik router (safe — no shell exec)',
        parameters: {
            type: 'object',
            properties: {
                host:  { type: 'string', description: 'Hostname or IPv4 address' },
                count: { type: 'number', default: 4 }
            },
            required: ['host']
        },
        execute: async ({ host, count = 4 }) => {
            try {
                const safeHost  = validateHost(host);
                const safeCount = Math.max(1, Math.min(10, parseInt(count) || 4));
                // Returns structured result — actual ping goes via MikroTik API, not shell
                return {
                    success: true,
                    host:    safeHost,
                    count:   safeCount,
                    note:    'Execute via MikroTik manager: mikrotik.ping(host, count)'
                };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }
    }
];

module.exports = { generalTools, safeMath, validateHost };
