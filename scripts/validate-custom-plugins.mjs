import assert from 'node:assert/strict';
import GraphEngineeringPlugin from '../src/plugins/custom/graph-engineering.js';
import WorkflowOrchestrationPlugin from '../src/plugins/custom/workflow-orchestration.js';
import WorkflowEngine from '../src/core/WorkflowEngine.js';

const graph = new GraphEngineeringPlugin({});
graph.addNode({ id: 'fetch' });
graph.addNode({ id: 'publish' });
graph.addEdge({ from: 'fetch', to: 'publish' });
assert.deepEqual(graph.topologicalSort().order, ['fetch', 'publish']);
assert.equal(graph.validate().valid, true);
graph.addEdge({ from: 'publish', to: 'fetch' });
assert.equal(graph.validate().valid, false);

const agent = { executeSkill: async (skill, params) => ({ skill, output: (params.value || 0) + 1 }) };
const engine = new WorkflowEngine(agent);
engine.register('increment', { steps: [{ skill: 'math.increment', params: { value: 1 }, output: 'answer' }] });
const workflowResult = await engine.execute('increment');
assert.equal(workflowResult.variables.answer, 2);

const plugin = new WorkflowOrchestrationPlugin(agent);
plugin.register('plugin-flow', { steps: [{ handler: async () => ({ output: 'ok' }), output: 'result' }] });
const executed = await plugin.execute('plugin-flow');
assert.equal(executed.status ?? 'completed', 'completed');
assert.equal(executed.variables.result, 'ok');
console.log('custom-plugin-smoke-ok');
