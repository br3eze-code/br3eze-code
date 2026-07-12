'use strict';
/**
 * src/kernel.js — backward-compatibility shim
 * ─────────────────────────────────────────────────────────────────
 * All existing callers of require('./kernel') or require('../kernel')
 * continue to work unchanged. The real implementation now lives in
 * src/core/agentKernel.js (domain-agnostic) so MikroTik is no longer
 * hardwired into the kernel.
 *
 * MikroTik-specific behaviour that was inline here:
 *   - getManager() call moved to src/domains/network/index.js
 *   - execute() still available via AgentKernel.dispatch()
 *
 * Do NOT delete this file — it is the stable require path.
 * ─────────────────────────────────────────────────────────────────
 */

const AgentKernel = require('./core/agentKernel');

// Re-export for existing callers that do:
//   const AgentKernel = require('./kernel')
//   const kernel = new AgentKernel()
//   kernel.execute(...)  ← still works via dispatch()
export default AgentKernel;
