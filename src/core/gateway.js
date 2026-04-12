/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║   AgentOS — Gateway.js                                           ║
 * ║                                                                  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *

 */

'use strict';

// ── import  ───────────────────────────────
const ChaosMonkey = require('./core/ChaosMonkey');

// ── Tool Schema (Gemini / Anthropic / OpenAI compatible) ──────
// ─────────────────────────────────────────────────────────────

const CHAOS_TOOLS = [

  // ── Networking ─────────────────────────────────────────────

  {
    name:        'chaos_drop_firewall_rules',
    description: 'CHAOS: Randomly disable 3 MikroTik firewall filter rules to test Sentinel self-healing.',
    parameters: {
      type: 'object',
      properties: {
        recovery_window: { type: 'number', description: 'Recovery window in ms (default 60000).' },
      },
    },
    handler: async ({ recovery_window } = {}) => {
      const rosCfg = {
        host:     process.env.ROS_HOST,
        user:     process.env.ROS_USER,
        password: process.env.ROS_PASS,
      };
      return ChaosMonkey.Networking.dropFirewallRules(rosCfg, {
        recovery_window: recovery_window ?? 60_000,
        sentinelCheck: async (chaos_id) => {
          return false; 
        },
      });
    },
  },

  {
    name:        'chaos_throttle_bandwidth',
    description: 'CHAOS: Apply a 64k global simple queue on MikroTik to simulate bandwidth bottleneck.',
    parameters: {
      type: 'object',
      properties: {
        recovery_window: { type: 'number', description: 'Recovery window in ms (default 60000).' },
      },
    },
    handler: async ({ recovery_window } = {}) => {
      const rosCfg = {
        host:     process.env.ROS_HOST,
        user:     process.env.ROS_USER,
        password: process.env.ROS_PASS,
      };
      return ChaosMonkey.Networking.throttleBandwidth(rosCfg, {
        recovery_window: recovery_window ?? 60_000,
      });
    },
  },

  {
    name:        'chaos_ghost_api',
    description: 'CHAOS: Open ghost sockets to the RouterOS API port to simulate Kernel interrupt / connection pool exhaustion.',
    parameters: {
      type: 'object',
      properties: {
        count:           { type: 'number',  description: 'Number of ghost sockets (default 3).' },
        recovery_window: { type: 'number',  description: 'Recovery window in ms (default 60000).' },
      },
    },
    handler: async ({ count, recovery_window } = {}) => {
      const rosCfg = {
        host: process.env.ROS_HOST,
        port: parseInt(process.env.ROS_PORT ?? '8728', 10),
      };
      return ChaosMonkey.Networking.ghostAPI(rosCfg, {
        count:           count           ?? 3,
        recovery_window: recovery_window ?? 60_000,
      });
    },
  },

  // ── Commerce ───────────────────────────────────────────────

  {
    name:        'chaos_corrupt_indexeddb',
    description: 'CHAOS: Inject a malformed JSON record into the local commerce catalog IDB store.',
    parameters: {
      type: 'object',
      properties: {
        recovery_window: { type: 'number', description: 'Recovery window in ms (default 60000).' },
      },
    },
    handler: async ({ recovery_window } = {}) => {
      return ChaosMonkey.Commerce.corruptIndexedDB({
        recovery_window: recovery_window ?? 60_000,
      });
    },
  },

  {
    name:        'chaos_latencies',
    description: 'CHAOS: Add a 5000ms latency shim to all Firestore sync calls.',
    parameters: {
      type: 'object',
      properties: {
        delayMs:         { type: 'number', description: 'Delay in ms (default 5000).' },
        recovery_window: { type: 'number', description: 'Recovery window in ms (default 60000).' },
      },
    },
    handler: async ({ delayMs, recovery_window } = {}) => {
      return ChaosMonkey.Commerce.latencies({
        delayMs:         delayMs         ?? 5000,
        recovery_window: recovery_window ?? 60_000,
      });
    },
  },

  // ── Safety ────────────────────────────────────────────────

  {
    name:        'chaos_panic_button',
    description: 'SAFETY: Instantly restore all AgentOS systems to last known Good State. Reverses all active chaos disruptions.',
    parameters:  { type: 'object', properties: {} },
    handler: async () => {
      const rosCfg = {
        host:     process.env.ROS_HOST,
        user:     process.env.ROS_USER,
        password: process.env.ROS_PASS,
      };
      return ChaosMonkey.panicButton(rosCfg);
    },
  },

  // ── Meta ──────────────────────────────────────────────────

  {
    name:        'chaos_status',
    description: 'Return the list of currently active chaos disruptions.',
    parameters:  { type: 'object', properties: {} },
    handler:     async () => ChaosMonkey.status(),
  },

  {
    name:        'chaos_list',
    description: 'List all registered chaos domains and their available disruption functions.',
    parameters:  { type: 'object', properties: {} },
    handler:     async () => ChaosMonkey.list(),
  },
];

// ══════════════════════════════════════════════════════════════
//  Gateway.js — registration 
//  ────────────────────────────────────────────────────────────



function registerChaosTools(gateway) {
  for (const tool of CHAOS_TOOLS) {
    // ── Pattern A: array push ────
    if (Array.isArray(gateway.tools)) {
      gateway.tools.push(tool);
    }

    // ── Pattern B: registerTool() method ─────────────────
    if (typeof gateway.registerTool === 'function') {
      gateway.registerTool(tool.name, tool.handler, {
        description: tool.description,
        parameters:  tool.parameters,
      });
    }

    // ── Pattern C: toolRegistry Map ──────────────────────
    if (gateway.toolRegistry instanceof Map) {
      gateway.toolRegistry.set(tool.name, tool);
    }
  }

  ChaosMonkey.on('recovered', data => {
    if (typeof gateway.emit === 'function') gateway.emit('sentinel:recovered', data);
  });
  ChaosMonkey.on('timeout', data => {
    if (typeof gateway.emit === 'function') gateway.emit('sentinel:timeout', data);
  });
  ChaosMonkey.on('panic', data => {
    if (typeof gateway.emit === 'function') gateway.emit('chaos:restored', data);
  });

  console.log(`[Gateway] ChaosMonkey registered — ${CHAOS_TOOLS.length} tools active.`);
  return CHAOS_TOOLS.length;
}

// ══════════════════════════════════════════════════════════════
//  Minimal self-contained usage example (standalone test)
// ══════════════════════════════════════════════════════════════

if (require.main === module) {
  (async () => {
    console.log('\n[ChaosMonkey Test] Available disruptions:');
    console.log(JSON.stringify(ChaosMonkey.list(), null, 2));

    console.log('\n[ChaosMonkey Test] Triggering latency chaos (no real Firestore needed)…');
    const result = await CHAOS_TOOLS
      .find(t => t.name === 'chaos_latencies')
      .handler({ delayMs: 2000, recovery_window: 10_000 });

    console.log('\n[ChaosMonkey Test] Result:', result);

    console.log('\n[ChaosMonkey Test] Panic button…');
    const panic = await CHAOS_TOOLS
      .find(t => t.name === 'chaos_panic_button')
      .handler();

    console.log('[ChaosMonkey Test] Panic result:', panic);
  })();
}

module.exports = { CHAOS_TOOLS, registerChaosTools };
