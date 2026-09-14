/**
 * @deprecated Compatibility entry point.
 *
 * The canonical runtime lives in src/core/agentRuntime.js.
 * This facade deliberately contains no domain/provider imports.
 */
export {
  AgentRuntime,
  RuntimeSession,
  getAgentRuntime,
  resetAgentRuntime,
  TOOL_MANIFEST
} from './core/agentRuntime.js';

export { default } from './core/agentRuntime.js';
