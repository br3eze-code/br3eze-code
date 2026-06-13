'use strict';
// agents/network.agent.js
// AgentOS - Network Intelligence Agent (MikroTik / ISP control)

/**
 * NETWORK AGENT ROLE:
 * - Handle all router / hotspot / user session operations
 * - NEVER touch billing or payments directly
 * - ONLY operate via mikrotik tools
 */
const networkAgent = {
    name: 'networkAgent',
 
    description: `
Handles MikroTik router operations including:
- hotspot user management
- bandwidth control
- session monitoring
- disconnections
- IP tracking
`,
 
    allowedTools: [
        'mikrotik.createUser',
        'mikrotik.removeUser',
        'mikrotik.disconnectUser',
        'mikrotik.getActiveUsers',
        'mikrotik.setBandwidth',
        'mikrotik.getUserStats'
    ],
 
    rules: [
        'Never create a user without a valid name',
        'Never disconnect admin users',
        'Always check if user exists before modifying',
        'Never modify billing or payment data',
        'Always log network actions'
    ],
 
    preprocess(input, context) {
        return {
            ...input,
            priority: 'high',
            safeMode: context.systemState?.mode !== 'production'
        };
    },
 
    postprocess(results) {
        return results.map(r => {
            if (!r.success) return { ...r, alert: 'Network operation failed' };
            return r;
        });
    }
};
 
module.exports = { networkAgent };

export const networkAgent = {
    name: "networkAgent",

    description: `
Handles MikroTik router operations including:
- hotspot user management
- bandwidth control
- session monitoring
- disconnections
- IP tracking
`,

    /**
     * TOOL ACCESS CONTROL
     */
    allowedTools: [
        "mikrotik.createUser",
        "mikrotik.removeUser",
        "mikrotik.disconnectUser",
        "mikrotik.getActiveUsers",
        "mikrotik.setBandwidth",
        "mikrotik.getUserStats"
    ],

    /**
     * SYSTEM RULES (VERY IMPORTANT)
     */
    rules: [
        "Never create a user without a valid name",
        "Never disconnect admin users",
        "Always check if user exists before modifying",
        "Never modify billing or payment data",
        "Always log network actions"
    ],

    /**
     * OPTIONAL PRE-PLANNING HOOK
     * Can modify or enrich input before planner runs
     */
    preprocess(input, context) {
        return {
            ...input,
            priority: "high", // network operations are critical
            safeMode: context.systemState?.mode !== "production"
        };
    },

    /**
     * OPTIONAL POST-EXECUTION HOOK
     */
    postprocess(results, context) {
        return results.map(r => {
            if (!r.success) {
                return {
                    ...r,
                    alert: "Network operation failed"
                };
            }
            return r;
        });
    }
};
