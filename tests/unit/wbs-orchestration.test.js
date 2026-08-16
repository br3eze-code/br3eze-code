import { describe, expect, test } from '@jest/globals';
import { buildExecutionContext } from '../../src/core/execution-context.js';
import {
  PromptTemplate,
  RunnableLambda,
  RunnableSequence,
  StateGraph
} from '../../src/core/orchestration/langchain-lite.js';

const wbs = [
  { id: 'step-1', order: 1, title: 'Plan', status: 'completed', result: 'done' },
  { id: 'step-2', order: 2, title: 'Execute', status: 'pending' }
];

describe('WBS prompt and orchestration primitives', () => {
  test('execution context exposes scoped WBS prompt state', () => {
    const context = buildExecutionContext({
      userId: 'user-1',
      tenantId: 'tenant-1',
      domain: 'network',
      siteId: 'site-1',
      wbs
    });

    expect(context.wbsSummary.progress).toBe(50);
    expect(context.wbsPrompt).toContain('Plan');
    expect(context.wbsPrompt).toContain('Execute');
    expect(context.wbsPrompt).not.toContain('tenant-2');
  });

  test('runnable sequence composes prompt and transformation', async () => {
    const chain = new RunnableSequence([
      new PromptTemplate('Task: {input}'),
      new RunnableLambda((value) => value.toUpperCase())
    ]);
    await expect(chain.invoke({ input: 'audit' })).resolves.toBe('TASK: AUDIT');
  });

  test('state graph executes each node once', async () => {
    const graph = new StateGraph()
      .addNode('start', (state) => ({ ...state, started: true }))
      .addNode('finish', (state) => ({ ...state, finished: true }))
      .addEdge('start', 'finish')
      .setEntryPoint('start')
      .compile();

    await expect(graph.invoke({})).resolves.toEqual({ started: true, finished: true });
  });
});
