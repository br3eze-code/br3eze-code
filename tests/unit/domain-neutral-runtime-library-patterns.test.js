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

describe('domain-neutral runtime library patterns', () => {
  test('evaluates a completed tenant-scoped execution', async () => {
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

  test('records and replays trajectories without mutating recorded events', () => {
    const recorder = new TrajectoryRecorder();
    recorder.record({ executionId: 'e1', step: 1, event: 'node.completed' });

    const returned = recorder.get('e1');
    returned[0].event = 'mutated-by-caller';

    const replay = replayTrajectory(recorder.get('e1'));
    expect(replay.count).toBe(1);
    expect(replay.events[0].event).toBe('node.completed');
  });

  test('defines and compiles a domain-neutral workflow from injected handlers', () => {
    const spec = defineWorkflow({
      id: 'demo',
      nodes: [{ id: 'prepare' }, { id: 'execute' }],
      edges: [{ from: 'prepare', to: 'execute' }],
    });
    const graph = compileWorkflow(spec, {
      handlers: { prepare: () => 'ready', execute: () => 'done' },
    });

    expect(graph.id).toBe('demo');
    expect(graph.nodes.prepare()).toBe('ready');
    expect(graph.nodes.execute()).toBe('done');
  });

  test('accounts model usage by tenant without coupling to a provider', () => {
    const meter = new UsageMeter();
    meter.record({
      executionId: 'e1',
      tenantId: 't1',
      provider: 'test-provider',
      model: 'test-model',
      inputTokens: 10,
      outputTokens: 5,
      cost: 0.01,
    });

    expect(meter.summarize('t1')).toMatchObject({
      requests: 1,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cost: 0.01,
    });
    expect(meter.summarize('other-tenant').requests).toBe(0);
  });

  test('rejects incomplete framework adapters before registration', () => {
    const registry = new FrameworkAdapterRegistry();
    expect(() => registry.register('incomplete', {})).toThrow(/missing capabilities/i);
  });
});
