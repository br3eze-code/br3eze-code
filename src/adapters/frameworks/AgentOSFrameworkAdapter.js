/**
 * Stable AgentOS boundary for external agent frameworks.
 * Core depends on this contract, never on a framework SDK.
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

  async createAgent(spec) { return this._call('createAgent', spec); }
  async runAgent(agent, input, context = {}) { return this._call('runAgent', agent, input, context); }
  async handoff(agent, target, context = {}) { return this._call('handoff', agent, target, context); }
  async createChild(agent, spec, context = {}) { return this._call('createChild', agent, spec, context); }
  async defineWorkflow(spec) { return this._call('defineWorkflow', spec); }
  async runWorkflow(workflow, input, context = {}) { return this._call('runWorkflow', workflow, input, context); }
  async resumeWorkflow(checkpoint, context = {}) { return this._call('resumeWorkflow', checkpoint, context); }
  async registerTool(tool) { return this._call('registerTool', tool); }
  async executeTool(tool, input, context = {}) { return this._call('executeTool', tool, input, context); }
  async checkGuardrail(input, context = {}) { return this._call('checkGuardrail', input, context); }
  async readMemory(query, context = {}) { return this._call('readMemory', query, context); }
  async writeMemory(entry, context = {}) { return this._call('writeMemory', entry, context); }
  async readTrace(executionId, context = {}) { return this._call('readTrace', executionId, context); }
  async evaluate(execution, expected, context = {}) { return this._call('evaluate', execution, expected, context); }

  async _call(name, ...args) {
    if (typeof this.factory?.[name] !== 'function') {
      throw new Error(`FRAMEWORK_FACTORY_${name.toUpperCase()}_UNAVAILABLE`);
    }
    return this.factory[name](...args);
  }
}

export function assertAdapterContract(adapter) {
  const required = [
    'createAgent', 'runAgent', 'handoff', 'createChild', 'defineWorkflow',
    'runWorkflow', 'resumeWorkflow', 'registerTool', 'executeTool',
    'checkGuardrail', 'readMemory', 'writeMemory', 'readTrace', 'evaluate'
  ];
  const missing = required.filter((name) => typeof adapter?.[name] !== 'function');
  if (missing.length) {
    const error = new Error(`FRAMEWORK_ADAPTER_CONTRACT: missing ${missing.join(', ')}`);
    error.code = 'FRAMEWORK_ADAPTER_CONTRACT';
    throw error;
  }
  return true;
}
