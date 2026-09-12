/**
 * Framework adapters translate an external agent framework into the AgentOS
 * runtime contract. Core never imports a framework SDK.
 */
export class AgentOSFrameworkAdapter {
  constructor({ id, version = '1.0', factory = null } = {}) {
    if (!id) throw new TypeError('FRAMEWORK_ADAPTER_ID_REQUIRED');
    this.id = id;
    this.version = version;
    this.factory = factory;
  }

  capabilities() {
    return [
      'agent.create', 'agent.run', 'agent.handoff', 'agent.child',
      'workflow.define', 'workflow.run', 'workflow.resume',
      'tool.register', 'tool.execute', 'guardrail.check',
      'memory.read', 'memory.write', 'trace.read', 'evaluation.run'
    ];
  }

  async createAgent(spec) {
    if (!this.factory?.createAgent) throw new Error('FRAMEWORK_FACTORY_CREATE_AGENT_UNAVAILABLE');
    return this.factory.createAgent(spec);
  }

  async runAgent(agent, input, context = {}) {
    if (!this.factory?.runAgent) throw new Error('FRAMEWORK_FACTORY_RUN_AGENT_UNAVAILABLE');
    return this.factory.runAgent(agent, input, context);
  }

  async handoff(agent, target, context = {}) {
    if (!this.factory?.handoff) throw new Error('FRAMEWORK_FACTORY_HANDOFF_UNAVAILABLE');
    return this.factory.handoff(agent, target, context);
  }

  async createChild(agent, spec, context = {}) {
    if (!this.factory?.createChild) throw new Error('FRAMEWORK_FACTORY_CHILD_UNAVAILABLE');
    return this.factory.createChild(agent, spec, context);
  }

  async defineWorkflow(spec) {
    if (!this.factory?.defineWorkflow) throw new Error('FRAMEWORK_FACTORY_WORKFLOW_DEFINE_UNAVAILABLE');
    return this.factory.defineWorkflow(spec);
  }

  async runWorkflow(workflow, input, context = {}) {
    if (!this.factory?.runWorkflow) throw new Error('FRAMEWORK_FACTORY_WORKFLOW_RUN_UNAVAILABLE');
    return this.factory.runWorkflow(workflow, input, context);
  }

  async resumeWorkflow(checkpoint, context = {}) {
    if (!this.factory?.resumeWorkflow) throw new Error('FRAMEWORK_FACTORY_WORKFLOW_RESUME_UNAVAILABLE');
    return this.factory.resumeWorkflow(checkpoint, context);
  }

  async registerTool(tool) { return this._call('registerTool', tool); }
  async executeTool(tool, input, context = {}) { return this._call('executeTool', tool, input, context); }
  async checkGuardrail(input, context = {}) { return this._call('checkGuardrail', input, context); }
  async readMemory(query, context = {}) { return this._call('readMemory', query, context); }
  async writeMemory(entry, context = {}) { return this._call('writeMemory', entry, context); }
  async readTrace(executionId, context = {}) { return this._call('readTrace', executionId, context); }
  async evaluate(execution, expected, context = {}) { return this._call('evaluate', execution, expected, context); }

  async _call(name, ...args) {
    if (!this.factory?.[name]) throw new Error(`FRAMEWORK_FACTORY_${name.toUpperCase()}_UNAVAILABLE`);
    return this.factory[name](...args);
  }
}

export function assertAdapterContract(adapter) {
  const required = ['createAgent', 'runAgent', 'handoff', 'createChild', 'defineWorkflow', 'runWorkflow', 'resumeWorkflow', 'registerTool', 'executeTool', 'checkGuardrail', 'readMemory', 'writeMemory', 'readTrace', 'evaluate'];
  const missing = required.filter((name) => typeof adapter?.[name] !== 'function');
  if (missing.length) {
    const error = new Error(`FRAMEWORK_ADAPTER_CONTRACT: missing ${missing.join(', ')}`);
    error.code = 'FRAMEWORK_ADAPTER_CONTRACT';
    throw error;
  }
  return true;
}
