import { describe, expect, test, jest } from '@jest/globals';
import { AgentRuntime, TOOL_MANIFEST } from '../../src/core/agentRuntime.js';
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
  test('keeps infrastructure and domain-specific actions out of core defaults', () => {
    const names = TOOL_MANIFEST.map((tool) => tool.name);
    expect(names).not.toContain('system.reboot');
    expect(names).not.toContain('user.add');
    expect(names).not.toContain('firewall.block');
  });

  test('routes direct capability calls through the canonical AgentRuntime boundary', async () => {
    const execute = jest.fn(async (name, args, context) => ({ name, args, tenantId: context.tenantId }));
    const registry = {
      getTool: jest.fn((name) => ({ name })),
      execute,
      getAllTools: () => [],
      getToolsForLLM: () => [],
      registerTool: jest.fn(),
      registerSkill: jest.fn(),
      loadSkills: jest.fn(),
    };
    const runtime = new AgentRuntime({ toolRegistry: registry });

    const result = await runtime.execute({
      content: 'look up an example',
      context: { tenantId: 'tenant-1', userId: 'user-1' },
      toolCalls: [{ name: 'example.lookup', arguments: { id: '42' } }],
    });

    expect(registry.getTool).toHaveBeenCalledWith('example.lookup');
    expect(execute).toHaveBeenCalledWith(
      'example.lookup',
      { id: '42' },
      expect.objectContaining({ tenantId: 'tenant-1', userId: 'user-1' }),
    );
    expect(result.toolsUsed).toEqual(['example.lookup']);
    expect(result.response).toEqual({
      name: 'example.lookup',
      args: { id: '42' },
      tenantId: 'tenant-1',
    });
  });

  test('adapts the runtime model request to the provider-manager contract', async () => {
    const execute = jest.fn(async () => ({ content: 'model response' }));
    const registry = {
      getTool: jest.fn(),
      execute: jest.fn(),
      getAllTools: () => [],
      getToolsForLLM: () => [],
      registerTool: jest.fn(),
      registerSkill: jest.fn(),
      loadSkills: jest.fn(),
    };
    const runtime = new AgentRuntime({
      toolRegistry: registry,
      providerManager: { execute },
    });

    const result = await runtime.execute({
      content: 'hello',
      context: { tenantId: 'tenant-1' },
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const [messages, tools, context] = execute.mock.calls[0];
    expect(messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(tools).toEqual([]);
    expect(context).toMatchObject({ tenantId: 'tenant-1' });
    expect(result.response).toBe('model response');
  });

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
