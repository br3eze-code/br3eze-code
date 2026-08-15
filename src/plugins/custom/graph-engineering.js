/**
 * AgentOS custom graph-engineering plugin.
 *
 * The plugin keeps graph state in memory by default and exposes deterministic
 * operations that workflow plugins and agents can compose: node/edge updates,
 * dependency validation, topological planning, and graph snapshots.
 */

export default class GraphEngineeringPlugin {
  constructor(agent, options = {}) {
    this.name = options.name || 'custom.graph-engineering';
    this.agent = agent;
    this.graphs = new Map();
    this.hooks = {
      preInitialize: async () => {},
      preShutdown: async () => { this.graphs.clear(); }
    };
  }

  initialize() {
    return this;
  }

  _graph(id = 'default') {
    if (!this.graphs.has(id)) this.graphs.set(id, { id, nodes: new Map(), edges: new Map(), updatedAt: Date.now() });
    return this.graphs.get(id);
  }

  _touch(graph) {
    graph.updatedAt = Date.now();
  }

  addNode({ graphId = 'default', id, data = {} } = {}) {
    if (!id || typeof id !== 'string') throw new TypeError('graph node id must be a non-empty string');
    const graph = this._graph(graphId);
    graph.nodes.set(id, { id, ...data });
    if (!graph.edges.has(id)) graph.edges.set(id, new Set());
    this._touch(graph);
    return { graphId, node: graph.nodes.get(id) };
  }

  addEdge({ graphId = 'default', from, to, relation = 'depends_on', data = {} } = {}) {
    if (!from || !to) throw new TypeError('graph edge requires from and to');
    const graph = this._graph(graphId);
    if (!graph.nodes.has(from)) this.addNode({ graphId, id: from });
    if (!graph.nodes.has(to)) this.addNode({ graphId, id: to });
    graph.edges.get(from).add(JSON.stringify({ to, relation, data }));
    this._touch(graph);
    return { graphId, from, to, relation };
  }

  validate({ graphId = 'default' } = {}) {
    const graph = this._graph(graphId);
    const errors = [];
    for (const [from, serializedEdges] of graph.edges) {
      for (const serialized of serializedEdges) {
        const edge = JSON.parse(serialized);
        if (!graph.nodes.has(from) || !graph.nodes.has(edge.to)) errors.push(`Dangling edge ${from} -> ${edge.to}`);
      }
    }
    const plan = this.topologicalSort({ graphId });
    if (!plan.acyclic) errors.push(`Cycle detected: ${plan.cycle.join(' -> ')}`);
    return { valid: errors.length === 0, errors, graphId };
  }

  topologicalSort({ graphId = 'default' } = {}) {
    const graph = this._graph(graphId);
    const indegree = new Map([...graph.nodes.keys()].map((id) => [id, 0]));
    const outgoing = new Map([...graph.nodes.keys()].map((id) => [id, []]));
    for (const [from, serializedEdges] of graph.edges) {
      for (const serialized of serializedEdges) {
        const { to } = JSON.parse(serialized);
        if (!indegree.has(to)) continue;
        indegree.set(to, indegree.get(to) + 1);
        outgoing.get(from).push(to);
      }
    }
    const queue = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id).sort();
    const order = [];
    while (queue.length) {
      const current = queue.shift();
      order.push(current);
      for (const next of outgoing.get(current) || []) {
        indegree.set(next, indegree.get(next) - 1);
        if (indegree.get(next) === 0) queue.push(next);
      }
      queue.sort();
    }
    if (order.length === graph.nodes.size) return { acyclic: true, order, cycle: [] };
    return { acyclic: false, order, cycle: [...indegree].filter(([, degree]) => degree > 0).map(([id]) => id) };
  }

  snapshot({ graphId = 'default' } = {}) {
    const graph = this._graph(graphId);
    return {
      id: graph.id,
      updatedAt: graph.updatedAt,
      nodes: [...graph.nodes.values()],
      edges: [...graph.edges].flatMap(([from, values]) => [...values].map((value) => ({ from, ...JSON.parse(value) })))
    };
  }

  async execute(action, args = {}) {
    const operations = { addNode: this.addNode, addEdge: this.addEdge, validate: this.validate, topologicalSort: this.topologicalSort, snapshot: this.snapshot };
    const operation = operations[action];
    if (!operation) throw new Error(`Unknown graph operation: ${action}`);
    return operation.call(this, args);
  }
}
