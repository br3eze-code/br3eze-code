import { describe, expect, test } from '@jest/globals';
import { buildExecutionContext } from '../../src/core/execution-context.js';
import { PromptTemplate, RunnableLambda, RunnableSequence, StateGraph } from '../../src/adapters/frameworks/langchain-lite.js';

const wbs = [
  { id: 'step-1', order: 1, title: 'Plan', status: 'completed', result: 'done' },
  { id: 'step-2', order: 2, title: 'Execute', status: 'pending' }
];

describe('WBS prompt and orchestration primitives', () => {
  test('execution context exposes scoped WBS prompt state', () => {
    const context = buildExecutionContext({ userId: 'user-1', tenantId: 'tenant-1', domain: 'network', wbs });
    expect(context.userId).toBe('user-1');
    expect(context.wbs).toEqual(wbs);
  });

  test('prompt template formats WBS-aware input', async () => {
    const prompt = new PromptTemplate('Execute {step} for {domain}');
    expect(await prompt.invoke({ step: 'step-2', domain: 'network' })).toBe('Execute step-2 for network');
  });

  test('runnable sequence executes WBS steps in order', async () => {
    const seen = [];
    const graph = new StateGraph();
    graph.addNode('plan', new RunnableLambda(async state => { seen.push('plan'); return { ...state, planned: true }; }));
    graph.addNode('execute', new RunnableLambda(async state => { seen.push('execute'); return { ...state, executed: true }; }));
    graph.addEdge('plan', 'execute').setEntryPoint('plan');
    const result = await graph.compile().invoke({ wbs });
    expect(seen).toEqual(['plan', 'execute']);
    expect(result.planned).toBe(true);
    expect(result.executed).toBe(true);
  });

  test('sequence pipes transformations', async () => {
    const sequence = new RunnableSequence([new RunnableLambda(value => value + 1), new RunnableLambda(value => value * 2)]);
    expect(await sequence.invoke(2)).toBe(6);
  });
});
