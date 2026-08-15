// src/core/WorkflowEngine.js
class WorkflowEngine {
  constructor(agent, options = {}) {
    this.agent = agent;
    this.workflows = new Map();
    this.logger = options.logger || agent?.logger || console;
  }

  register(id, definition = {}) {
    if (!id || typeof id !== 'string') throw new TypeError('workflow id must be a non-empty string');
    if (!Array.isArray(definition.steps)) throw new TypeError(`workflow '${id}' requires a steps array`);
    this.workflows.set(id, { id, ...definition, steps: definition.steps.map((step, index) => ({ id: step.id || `step-${index + 1}`, ...step })), createdAt: Date.now() });
    return this.workflows.get(id);
  }

  async execute(workflowId, params = {}, context = {}) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
    const results = [];
    const variables = { ...params };

    for (let i = 0; i < workflow.steps.length; i += 1) {
      const step = workflow.steps[i];
      try {
        const resolvedParams = this.resolveVariables(step.params || {}, variables);
        const result = step.workflow
          ? await this.execute(step.workflow, resolvedParams, context)
          : await this.agent.executeSkill(step.skill, resolvedParams, context);
        results.push({ step: i, id: step.id, success: true, result });
        if (step.output) variables[step.output] = result?.output ?? result;
        if (step.condition && !this.evaluateCondition(step.condition, variables)) break;
      } catch (error) {
        results.push({ step: i, id: step.id, success: false, error: error.message });
        if (step.onError) {
          try {
            await this.agent.executeSkill(step.onError.skill, step.onError.params || {}, context);
          } catch (handlerError) {
            this.logger.error?.(`Workflow error handler failed at ${workflowId}/${step.id}: ${handlerError.message}`);
            if (workflow.onError !== 'continue') throw handlerError;
          }
        }
        if (workflow.onError === 'stop' || (!workflow.onError && !step.onError)) throw error;
      }
    }

    return { workflow: workflowId, success: results.every((result) => result.success), steps: results, variables };
  }

  resolveVariables(value, variables) {
    if (typeof value === 'string' && value.startsWith('$')) return variables[value.slice(1)];
    if (Array.isArray(value)) return value.map((entry) => this.resolveVariables(entry, variables));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, this.resolveVariables(entry, variables)]));
    return value;
  }

  evaluateCondition(condition, variables) {
    const { var: varName, op, value } = condition || {};
    const actual = variables[varName];
    switch (op) {
      case 'eq': return actual === value;
      case 'ne': return actual !== value;
      case 'gt': return actual > value;
      case 'lt': return actual < value;
      case 'exists': return actual !== undefined && actual !== null;
      default: return true;
    }
  }
}

export default WorkflowEngine;
