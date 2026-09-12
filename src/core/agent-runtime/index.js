export { ExecutionGraph, START, END } from './ExecutionGraph.js';
export { ExecutionStatus, createExecutionState, transitionExecution } from './ExecutionState.js';
export { InMemoryCheckpointStore, assertCheckpointStore } from './CheckpointStore.js';
export { AgentSupervisor } from './AgentSupervisor.js';
export { ExecutionPolicy, withTimeout } from './ExecutionPolicy.js';
export { ContextManager, InMemoryMemoryStore } from './ContextManager.js';
export { GuardrailPipeline, GuardrailViolation } from './Guardrails.js';
export { TraceCollector } from './Tracing.js';
export { validateStructuredOutput, StructuredOutputError } from './StructuredOutput.js';

export const AGENT_RUNTIME_CAPABILITIES = Object.freeze([
  'graph.execution', 'conditional.routing', 'checkpoint.resume', 'pause.resume',
  'retry.backoff', 'parallel.fanout', 'parallel.fanin', 'agent.handoff',
  'child.agents', 'human.approval', 'guardrails', 'tenant.scope',
  'context.compaction', 'memory.namespaces', 'retrieval.adapter',
  'structured.output', 'tracing.spans', 'idempotent.side_effects',
  'streaming.events', 'evaluation.hooks'
]);
