import { describe, expect, test } from '@jest/globals';
import {
  EvaluationSuite,
  createBasicEvaluators,
  TrajectoryRecorder,
  replayTrajectory,
  defineWorkflow,
  compileWorkflow,
  UsageMeter,
  FrameworkAdapterRegistry,
} from '../../src/core/agent-runtime/index.js';

describe('domain-neutral runtime capabilities', () => {
  test('evaluates completed tenant-scoped execution', async () => {
    const suite = new EvaluationSuite({ evaluators: createBasicEvaluators() });
    const report = await suite.run({
      execution: {
        executionId: 'e1',
        tenantId: 't1',
        userId: 'u1',
        status: 'completed',
        output: { ok: true },
      },
    });

    expect(report.passed).toBe(true);
    expect(report.score).toBe(1);
  });

  test('records and replays trajectories without mutating stored events', () => {
    const recorder = new TrajectoryRecorder();
    recorder.record({ executionId: 'e1', step: 1, event: 'node.completed' });

    const returned = recorder.get('e1');
    returned[0].event = 'mutated-outside-store';

    const replay = replayTrajectory(recorder.get('e1'));
    expect(replay.count).toBe(1);
    expect(replay.events[0].event).toBe('node.completed');
  });

  test('compiles a domain-neutral declarative workflow', () => {
    const spec = defineWorkflow({
      id: 'demo',
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [{ from: 'a', to: 'b' }],
    });
    const graph = compileWorkflow(spec, {
      handlers: { a: () => 1, b: () => 2 },
    });

    expect(graph.id).toBe('demo');
    expect(typeof graph.nodes.a).toBe('function');
  });

  test('rejects duplicate workflow nodes and dangling edges', () => {
    expect(() => defineWorkflow({
      id: 'duplicate',
      nodes: [{ id: 'a' }, { id: 'a' }],
    })).toThrow(/duplicate node ids/i);

    expect(() => defineWorkflow({
      id: 'dangling',
      nodes: [{ id: 'a' }],
      edges: [{ from: 'a', to: 'missing' }],
    })).toThrow(/unknown node/i);
  });

  test('accounts model usage per tenant', () => {
    const meter = new UsageMeter();
    meter.record({ tenantId: 't1', inputTokens: 10, outputTokens: 5, cost: 0.01 });

    expect(meter.summarize('t1')).toMatchObject({
      requests: 1,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cost: 0.01,
    });
    expect(() => meter.record({ inputTokens: 1 })).toThrow(/tenantId/i);
  });

  test('maps framework capability names to explicit adapter methods', () => {
    const registry = new FrameworkAdapterRegistry();
    const methods = [
      'createAgent', 'runAgent', 'handoff', 'createChild',
      'defineWorkflow', 'runWorkflow', 'resumeWorkflow',
      'registerTool', 'executeTool', 'checkGuardrail',
      'readMemory', 'writeMemory', 'readTrace', 'evaluate',
    ];
    const adapter = Object.fromEntries(methods.map((name) => [name, async () => ({ ok: true })]));

    expect(registry.register('test-framework', adapter)).toBe(adapter);
    expect(registry.get('test-framework')).toBe(adapter);
  });

  test('rejects incomplete framework adapters', () => {
    const registry = new FrameworkAdapterRegistry();
    expect(() => registry.register('bad', {})).toThrow(/missing capabilities/i);
  });
});
