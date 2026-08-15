import GraphEngineeringPlugin from './graph-engineering.js';
import WorkflowOrchestrationPlugin from './workflow-orchestration.js';

export { GraphEngineeringPlugin, WorkflowOrchestrationPlugin };

export async function loadCustomPlugins(agent, options = {}) {
  const graph = new GraphEngineeringPlugin(agent, options.graph || {});
  const workflows = new WorkflowOrchestrationPlugin(agent, options.workflows || {});
  await graph.initialize?.();
  await workflows.initialize?.();
  return { graph, workflows };
}

export default { GraphEngineeringPlugin, WorkflowOrchestrationPlugin, loadCustomPlugins };
