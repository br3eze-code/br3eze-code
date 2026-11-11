/**
 * MikroTik skill — the network domain as a runtime plugin.
 *
 * Inject a mikrotik client; the runtime stays network-unaware.
 * Disconnecting a user is high risk and is not selected from free text.
 */
import { defineSkill, defineTool } from '../skill.js';

export function createMikrotikSkill(mikrotik) {
  if (!mikrotik) throw new Error('createMikrotikSkill requires a mikrotik client');

  const tools = [
    defineTool({
      name: 'network.who',
      description: 'List currently active hotspot users on the router.',
      permissions: ['network:read'],
      risk: 'low',
      parameters: { type: 'object', properties: {} },
      handler: async () => {
        const users = await mikrotik.getActiveUsers();
        return { count: Array.isArray(users) ? users.length : 0, users: users || [] };
      },
    }),
    defineTool({
      name: 'network.kick',
      description: 'Disconnect an active hotspot user by name. Requires explicit authorization.',
      permissions: ['network:disconnect'],
      risk: 'high',
      parameters: {
        type: 'object',
        required: ['username'],
        properties: { username: { type: 'string', description: 'Hotspot username' } },
      },
      handler: async ({ username }) => {
        if (!username || typeof username !== 'string') throw new Error('username is required');
        return mikrotik.kickUser ? mikrotik.kickUser(username) : mikrotik.disableHotspotUser(username);
      },
    }),
    defineTool({
      name: 'network.stats',
      description: 'Get router system stats (CPU, memory, uptime).',
      permissions: ['network:read'],
      risk: 'low',
      parameters: { type: 'object', properties: {} },
      handler: async () => mikrotik.getSystemStats(),
    }),
  ];

  return defineSkill({
    name: 'mikrotik',
    description: 'MikroTik RouterOS hotspot management.',
    permissions: ['network:read'],
    tools,
    persona: 'You can inspect a MikroTik hotspot and read router stats. Disconnecting a user requires an explicit authorized tool call.',
    match: (input) => {
      const s = String(input).toLowerCase().trim();
      if (/^(who|who's online|active users|whoyaya)$/.test(s)) return { tool: 'network.who', args: {} };
      if (/\b(router|system)\s+stats\b/.test(s) || s === 'stats') return { tool: 'network.stats', args: {} };
      return null;
    },
  });
}
