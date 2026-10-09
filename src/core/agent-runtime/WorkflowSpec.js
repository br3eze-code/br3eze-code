export function defineWorkflow({ id, version = 1, nodes = [], edges = [], metadata = {} } = {}) {
  if (!id || typeof id !== 'string') throw new TypeError('workflow id is required');
  if (!Array.isArray(nodes) || !Array.isArray(edges)) throw new TypeError('nodes and edges must be arrays');
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length) throw new Error('workflow contains duplicate node ids');
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new Error(`workflow edge references unknown node: ${edge.from} -> ${edge.to}`);
  }
  return Object.freeze({ id, version, nodes: structuredClone(nodes), edges: structuredClone(edges), metadata: structuredClone(metadata) });
}

export function compileWorkflow(spec, { handlers = {} } = {}) {
  if (!spec?.id) throw new TypeError('workflow spec is required');
  const compiled = {};
  for (const node of spec.nodes) {
    if (typeof handlers[node.id] !== 'function') throw new Error(`Missing handler for workflow node: ${node.id}`);
    compiled[node.id] = handlers[node.id];
  }
  return { id: spec.id, version: spec.version, nodes: compiled, edges: spec.edges.map((edge) => ({ ...edge })), metadata: structuredClone(spec.metadata) };
}

export default defineWorkflow;
