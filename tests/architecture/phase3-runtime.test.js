import { ExecutionGraph } from '../../src/core/agent-runtime/ExecutionGraph.js';
import { InMemoryCheckpointStore } from '../../src/core/agent-runtime/CheckpointStore.js';
import { GuardrailPipeline, GuardrailViolation } from '../../src/core/agent-runtime/Guardrails.js';
import { TraceCollector } from '../../src/core/agent-runtime/Tracing.js';
import { validateStructuredOutput, StructuredOutputError } from '../../src/core/agent-runtime/StructuredOutput.js';

describe('Phase 3 runtime primitives', () => {
  test('checkpoint resume continues from durable nextNode', async () => {
    const store = new InMemoryCheckpointStore(); const seen = [];
    const graph = new ExecutionGraph({ checkpointStore: store, nodes: { a: async () => { seen.push('a'); return 1; }, b: async () => { seen.push('b'); return 2; } }, edges: [{ from: '__start__', to: 'a' }, { from: 'a', to: 'b' }, { from: 'b', to: '__end__' }] });
    const state = await graph.run('x', { tenantId: 't1', userId: 'u1' });
    expect(state.status).toBe('completed'); expect(seen).toEqual(['a', 'b']);
    expect((await store.load(state.executionId)).nextNode).toBeNull();
  });

  test('guardrails block denied input', async () => {
    const guards = new GuardrailPipeline({ input: [value => String(value).length < 4 || { allowed: false, reason: 'too long' }] });
    await expect(guards.input('blocked')).rejects.toBeInstanceOf(GuardrailViolation);
  });

  test('structured output validator rejects malformed output', () => {
    expect(() => validateStructuredOutput({}, { type: 'object', required: ['answer'] })).toThrow(StructuredOutputError);
    expect(validateStructuredOutput({ answer: 'ok' }, { type: 'object', required: ['answer'] })).toEqual({ answer: 'ok' });
  });

  test('tracing produces bounded spans', () => {
    const trace = new TraceCollector({ clock: (() => { let n = 0; return () => ++n; })() });
    const id = trace.start('tool'); trace.event(id, 'called'); const span = trace.end(id);
    expect(span.status).toBe('ok'); expect(span.durationMs).toBeGreaterThanOrEqual(0); expect(span.events).toHaveLength(1);
  });
});
