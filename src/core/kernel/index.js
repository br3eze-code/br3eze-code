/**
 * AgentOS kernel public boundary.
 *
 * This module is intentionally domain-neutral. Domain knowledge belongs in
 * adapters, skills and plugins loaded outside the kernel.
 */
export { PHASES, RISK_LEVELS, describeCapability, checkCapabilityBoundary, createExecutionIntent } from '../capability-boundary.js';
export { TaskRegistry, TaskStatus, TaskPhase, TERMINAL_STATUSES, requiresApprovalByAction, getTaskRegistry } from '../taskRegistry.js';
export { default as AgentOSOrchestrator } from '../orchestrator.js';

export const KERNEL_CONTRACT_VERSION = '1';
