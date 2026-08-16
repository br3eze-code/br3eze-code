import GraphEngineeringPlugin from '../../../src/plugins/custom/graph-engineering.js';

describe('graph-engineering execution context isolation', () => {
  const contextA = {
    userId: 'user-a',
    scope: { tenantId: 'tenant-a', domain: 'workspace', siteId: 'site-1' }
  };
  const contextB = {
    userId: 'user-b',
    scope: { tenantId: 'tenant-b', domain: 'workspace', siteId: 'site-1' }
  };

  test('does not share the same logical graph across tenant/user contexts', () => {
    const plugin = new GraphEngineeringPlugin(null).initialize();
    plugin.addNode({ graphId: 'project', id: 'a-only', context: contextA });
    plugin.addNode({ graphId: 'project', id: 'b-only', context: contextB });

    const graphA = plugin.snapshot({ graphId: 'project', context: contextA });
    const graphB = plugin.snapshot({ graphId: 'project', context: contextB });

    expect(graphA.nodes.map((node) => node.id)).toEqual(['a-only']);
    expect(graphB.nodes.map((node) => node.id)).toEqual(['b-only']);
    expect(graphA.storageId).not.toBe(graphB.storageId);
    expect(graphA.scope).toEqual({ tenantId: 'tenant-a', userId: 'user-a', domain: 'workspace', siteId: 'site-1' });
  });

  test('passes context through execute and keeps validation scoped', async () => {
    const plugin = new GraphEngineeringPlugin(null).initialize();
    await plugin.execute('addEdge', { graphId: 'workflow', from: 'start', to: 'finish' }, contextA);
    const result = await plugin.execute('snapshot', { graphId: 'workflow' }, contextA);
    const validation = await plugin.execute('validate', { graphId: 'workflow' }, contextA);

    expect(result.nodes.map((node) => node.id)).toEqual(['start', 'finish']);
    expect(result.edges).toEqual([{ from: 'start', to: 'finish', relation: 'depends_on', data: {} }]);
    expect(validation).toMatchObject({ graphId: 'workflow', valid: true });
  });

  test('retains legacy unscoped graph behavior', () => {
    const plugin = new GraphEngineeringPlugin(null).initialize();
    plugin.addNode({ graphId: 'legacy', id: 'node' });
    expect(plugin.snapshot({ graphId: 'legacy' }).nodes).toEqual([{ id: 'node' }]);
  });
});
