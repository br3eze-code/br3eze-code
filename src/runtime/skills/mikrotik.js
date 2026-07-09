/**
 * MikroTik skill — the network domain as a runtime plugin.
 *
 * Demonstrates the domain-agnostic model: what was hardcoded into the core is
 * now one composable skill. Inject a mikrotik client; the runtime stays
 * network-unaware.
 *
 *     rt.use(createMikrotikSkill(mikrotikClient));
 */
'use strict';

const { defineSkill, defineTool } = require('../skill');

function createMikrotikSkill(mikrotik) {
    if (!mikrotik) throw new Error('createMikrotikSkill requires a mikrotik client');

    const tools = [
        defineTool({
            name: 'network.who',
            description: 'List currently active hotspot users on the router.',
            parameters: { type: 'object', properties: {} },
            handler: async () => {
                const users = await mikrotik.getActiveUsers();
                return { count: users.length, users };
            },
        }),
        defineTool({
            name: 'network.kick',
            description: 'Disconnect an active hotspot user by name.',
            parameters: { type: 'object', properties: { username: { type: 'string', description: 'Hotspot username' } }, required: ['username'] },
            handler: async ({ username }) => {
                if (!username) throw new Error('username is required');
                return mikrotik.kickUser ? mikrotik.kickUser(username) : mikrotik.disableHotspotUser(username);
            },
        }),
        defineTool({
            name: 'network.stats',
            description: 'Get router system stats (CPU, memory, uptime).',
            parameters: { type: 'object', properties: {} },
            handler: async () => mikrotik.getSystemStats(),
        }),
    ];

    return defineSkill({
        name: 'mikrotik',
        description: 'MikroTik RouterOS hotspot management.',
        tools,
        persona: 'You can inspect and manage a MikroTik hotspot: list active users, kick a user, and read router stats.',
        // Fast paths so common asks skip the LLM.
        match: (input) => {
            const s = String(input).toLowerCase().trim();
            if (/^(who|who'?s online|active users|whoyaya)$/.test(s) || s === 'who') return { tool: 'network.who', args: {} };
            const kick = s.match(/^(?:kick|disconnect|disable)\s+(?:user\s+)?([\w@.\-]+)/);
            if (kick) return { tool: 'network.kick', args: { username: kick[1] } };
            if (/\b(router|system)\s+stats\b/.test(s) || s === 'stats') return { tool: 'network.stats', args: {} };
            return null;
        },
    });
}

module.exports = { createMikrotikSkill };
