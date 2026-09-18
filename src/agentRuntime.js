/**
 * Backward-compatible entry point for the domain-neutral runtime.
 * The implementation lives in core/agentRuntime.js.
 */
export {
  AgentRuntime,
  RuntimeSession,
  getAgentRuntime,
  TOOL_MANIFEST
} from './core/agentRuntime.js';
export { default } from './core/agentRuntime.js';
