/**
 * Stable AgentOS boundary for external agent frameworks.
 * Core depends on this contract, never on a framework SDK.
 */
const CAPABILITY_METHODS = Object.freeze({
  'agent.create': 'createAgent',
  'agent.run': 'runAgent',
  'agent.remove': 'removeAgent',
  'agent.handoff': 'handoff',
  'agent.child': 'createChild',
  'workflow.define': 'defineWorkflow',
  'workflow.run': 'runWorkflow',
  'workflow.resume': 'resumeWorkflow',
  'tool.register': 'registerTool',
  'tool.execute': 'executeTool',
  'guardrail.check': 'checkGuardrail',
  'memory.read': 'readMemory',
  'memory.write': 'writeMemory',
  'trace.read': 'readTrace',
  'evaluation.run': 'evaluate',
});

export class AgentOSFrameworkAdapter {
  constructor({ id, version = '1.0', factory = null } = {}) {
    if (!id) throw new TypeError('FRAMEWORK_ADAPTER_ID_REQUIRED');
    this.id = id;
    this.version = version;
    this.factory = factory;
  }

  // Advertise only operations backed by a real factory handler. Wrapper methods
  // exist for a stable API, but their existence alone is not implementation.
  capabilities() {
    return Object.entries(CAPABILITY_METHODS)
      .filter(([, method]) => typeof this.factory?.[method] === 'function')
      .map(([capability]) => capability);
  }

  async createAgent(spec) { return this._call('createAgent', spec); }
  async runAgent(agent, input, context = {}) { return this._call('runAgent', agent, input, context); }
  async removeAgent(agentId, context = {}) { return this._call('removeAgent', agentId, context); }
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
      const error = new Error(`FRAMEWORK_FACTORY_${name.toUpperCase()}_UNAVAILABLE`);
      error.code = 'CAPABILITY_UNAVAILABLE';
      throw error;
    }
    return this.factory[name](...args);
  }
}

export function assertAdapterContract(adapter, { requiredCapabilities = null } = {}) {
  const legacyRequired = [
    'createAgent', 'runAgent', 'removeAgent', 'handoff', 'createChild', 'defineWorkflow',
    'runWorkflow', 'resumeWorkflow', 'registerTool', 'executeTool',
    'checkGuardrail', 'readMemory', 'writeMemory', 'readTrace', 'evaluate'
  ];
  const advertised = typeof adapter?.capabilities === 'function' ? adapter.capabilities() : null;
  if (advertised !== null && (!Array.isArray(advertised) || advertised.some((capability) => !Object.hasOwn(CAPABILITY_METHODS, capability)))) {
    const error = new Error('FRAMEWORK_CAPABILITY_DECLARATION_INVALID');
    error.code = 'FRAMEWORK_CAPABILITY_DECLARATION_INVALID';
    throw error;
  }

  const requiredCapabilitiesList = requiredCapabilities === null
    ? null
    : requiredCapabilities;
  if (requiredCapabilitiesList !== null) {
    const unknown = requiredCapabilitiesList.filter((capability) => !Object.hasOwn(CAPABILITY_METHODS, capability));
    if (unknown.length) {
      const error = new Error(`Unknown framework capabilities: ${unknown.join(', ')}`);
      error.code = 'FRAMEWORK_CAPABILITY_UNKNOWN';
      throw error;
    }
    const missingCapabilities = advertised === null
      ? []
      : requiredCapabilitiesList.filter((capability) => !advertised.includes(capability));
    if (missingCapabilities.length) {
      const error = new Error(`FRAMEWORK_ADAPTER_CONTRACT: missing ${missingCapabilities.join(', ')}`);
      error.code = 'FRAMEWORK_ADAPTER_CONTRACT';
      error.missing = missingCapabilities;
      throw error;
    }
  }

  const required = requiredCapabilitiesList === null
    ? legacyRequired
    : requiredCapabilitiesList.map((capability) => CAPABILITY_METHODS[capability]);
  const missing = required.filter((name) => typeof adapter?.[name] !== 'function');
  const invalid = advertised !== null && advertised.some((capability) => {
    const method = CAPABILITY_METHODS[capability];
    return typeof adapter.factory?.[method] !== 'function';
  });
  if (missing.length || invalid) {
    const error = new Error(missing.length
      ? `FRAMEWORK_ADAPTER_CONTRACT: missing ${missing.join(', ')}`
      : 'FRAMEWORK_CAPABILITY_DECLARATION_INVALID');
    error.code = invalid ? 'FRAMEWORK_CAPABILITY_DECLARATION_INVALID' : 'FRAMEWORK_ADAPTER_CONTRACT';
    if (missing.length) error.missing = missing;
    throw error;
  }
  return true;
}
