import { WorkGraph, WorkStatus } from '../../src/workgraph/workGraph.js';
import { ExecutionStatus } from '../../src/workgraph/executionRecord.js';
import { VerificationEngine, VerificationStatus } from '../../src/verification/verificationEngine.js';
import { AgentRuntime } from '../../src/core/agentRuntime.js';

describe('canonical work graph runtime', () => {
  test('runs dependencies in order and records execution', async () => {
    const graph = new WorkGraph({ goal: 'verified execution' });
    const plan = graph.addTask({ id: 'plan', title: 'Plan' });
    graph.addTask({ id: 'execute', title: 'Execute', dependsOn: [plan.id] });

    const runtime = new AgentRuntime({
      verificationChecks: { completed: result => result?.ok === true },
    });
    const order = [];
    const result = await runtime.executeWorkGraph(graph, {
      executor: async task => {
        order.push(task.id);
        return { ok: true, taskId: task.id };
      },
    });

    expect(order).toEqual(['plan', 'execute']);
    expect(result.summary.completed).toBe(2);
    expect(result.records).toHaveLength(2);
    expect(result.records.every(record => record.status === ExecutionStatus.SUCCEEDED)).toBe(true);
  });

  test('fails a task when declared verification fails', async () => {
    const graph = new WorkGraph({ goal: 'fail closed' });
    graph.addTask({ id: 'verify', title: 'Verify', verification: ['required'] });
    const runtime = new AgentRuntime({
      verificationChecks: { required: () => false },
    });

    const result = await runtime.executeWorkGraph(graph, {
      executor: async () => ({ ok: true }),
    });

    expect(result.records[0].status).toBe(ExecutionStatus.FAILED);
    expect(result.graph.get('verify').status).toBe(WorkStatus.FAILED);
  });

  test('verification engine fails closed for unknown checks', async () => {
    const engine = new VerificationEngine();
    const result = await engine.verify({}, ['missing']);
    expect(result.status).toBe(VerificationStatus.FAILED);
    expect(result.passed).toBe(false);
  });
});
