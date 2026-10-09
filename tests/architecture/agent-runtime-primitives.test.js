import { ExecutionGraph, START, END, InMemoryCheckpointStore, AgentSupervisor, ExecutionPolicy } from '../../src/core/agent-runtime/index.js';

describe('framework-neutral agent runtime', () => {
  test('executes a graph and checkpoints state', async () => {
    const store = new InMemoryCheckpointStore();
    const graph = new ExecutionGraph({ checkpointStore: store });
    graph.addEdge(START, 'a').addEdge('a', 'b').addEdge('b', END);
    graph.addNode('a', async ({ input }) => `${input}-a`);
    graph.addNode('b', async ({ state }) => `${state.output}-b`);
    const result = await graph.run('x', { tenantId: 't1', userId: 'u1', executionId: 'e1' });
    expect(result.status).toBe('completed');
    expect(result.output).toBe('x-a-b');
    expect(store.load('e1').nodeId).toBe(END);
  });

  test('rejects missing scope', async () => {
    const graph = new ExecutionGraph();
    await expect(graph.run('x', { executionId: 'e2' })).rejects.toThrow(/tenantId and userId/);
  });

  test('limits child agents to parent scope', () => {
    const supervisor = new AgentSupervisor();
    const parent = { id: 'p', tenantId: 't1', userId: 'u1', depth: 0, capabilities: ['a'] };
    expect(supervisor.spawn(parent, { tenantId: 't1', userId: 'u1', capabilities: ['a', 'b'] }).capabilities).toEqual(['a']);
    expect(() => supervisor.spawn(parent, { tenantId: 't2', userId: 'u1' })).toThrow(/scope/);
  });

  test('retries bounded failures', async () => {
    const policy = new ExecutionPolicy({ maxRetries: 2, backoffMs: 0 }); let attempts = 0;
    await expect(policy.retry(async () => { attempts++; throw new Error('x'); })).rejects.toThrow('x');
    expect(attempts).toBe(3);
  });
});
