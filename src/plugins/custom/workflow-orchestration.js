import crypto from 'node:crypto';

export default class WorkflowOrchestrationPlugin {
  constructor(agent, options = {}) {
    this.name = options.name || 'custom.workflow-orchestration';
    this.agent = agent;
    this.maxConcurrency = Number(options.maxConcurrency || 4);
    this.workflows = new Map();
    this.running = new Map();
    this.hooks = {
      preShutdown: async () => { this.running.clear(); }
    };
  }

  initialize() {
    if (this.agent?.workflowEngine) {
      for (const [id, definition] of this.workflows) this.agent.workflowEngine.register(id, definition);
    }
    return this;
  }

  register(id, definition) {
    if (!id || typeof id !== 'string') throw new TypeError('workflow id must be a non-empty string');
    if (!definition || !Array.isArray(definition.steps)) throw new TypeError(`workflow '${id}' requires a steps array`);
    this.workflows.set(id, { id, ...definition, steps: definition.steps.map((step, index) => ({ id: step.id || `step-${index + 1}`, ...step })) });
    this.agent?.workflowEngine?.register(id, this.workflows.get(id));
    return this.workflows.get(id);
  }

  _limitSteps(steps) {
    const queue = [...steps];
    const results = [];
    return { queue, results };
  }

  async execute(id, params = {}, context = {}) {
    const workflow = this.workflows.get(id) || this.agent?.workflowEngine?.workflows?.get(id);
    if (!workflow) throw new Error(`Workflow not found: ${id}`);
    const executionId = crypto.randomUUID();
    const startedAt = Date.now();
    const record = { executionId, workflowId: id, status: 'running', startedAt };
    this.running.set(executionId, record);
    try {
      const result = this.agent?.workflowEngine?.workflows?.has(id)
        ? await this.agent.workflowEngine.execute(id, params, { ...context, executionId })
        : await this._executeDefinition(workflow, params, context, executionId);
      const completed = { ...record, status: result.success === false ? 'failed' : 'completed', completedAt: Date.now(), result };
      this.running.set(executionId, completed);
      return { executionId, ...result };
    } catch (error) {
      const failed = { ...record, status: 'failed', completedAt: Date.now(), error: error.message };
      this.running.set(executionId, failed);
      error.executionId = executionId;
      throw error;
    }
  }

  async _executeDefinition(workflow, params, context, executionId) {
    const variables = { ...params };
    const steps = this._limitSteps(workflow.steps).queue;
    const results = [];
    for (const step of steps) {
      try {
        const input = this._resolve(step.params || {}, variables);
        const result = step.handler ? await step.handler(input, { ...context, executionId, variables }) : await this.agent.executeSkill(step.skill, input, { ...context, executionId });
        results.push({ id: step.id, success: true, result });
        if (step.output) variables[step.output] = result?.output ?? result;
      } catch (error) {
        results.push({ id: step.id, success: false, error: error.message });
        if (workflow.onError !== 'continue') throw error;
      }
    }
    return { workflow: workflow.id, success: results.every((item) => item.success), steps: results, variables };
  }

  _resolve(value, variables) {
    if (typeof value === 'string' && value.startsWith('$')) return variables[value.slice(1)];
    if (Array.isArray(value)) return value.map((entry) => this._resolve(entry, variables));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, this._resolve(entry, variables)]));
    return value;
  }

  status(executionId) {
    return this.running.get(executionId) || null;
  }
}
