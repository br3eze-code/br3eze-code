export const FRAMEWORK_CONTRACT = Object.freeze([
  'agent.create', 'agent.run', 'agent.remove', 'agent.handoff', 'agent.child',
  'workflow.define', 'workflow.run', 'workflow.resume',
  'tool.register', 'tool.execute', 'guardrail.check',
  'memory.read', 'memory.write', 'trace.read', 'evaluation.run',
]);

const FRAMEWORK_METHODS = Object.freeze({
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

/**
 * Validate a framework adapter against an explicit capability set.
 * By default the legacy complete contract is required. New integrations can
 * pass requiredCapabilities: [] and implement only their declared capabilities.
 */
export function assertFrameworkAdapter(adapter, { requiredCapabilities = FRAMEWORK_CONTRACT } = {}) {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('framework adapter must be an object');
  if (!Array.isArray(requiredCapabilities)) throw new TypeError('requiredCapabilities must be an array');

  const unknownRequired = requiredCapabilities.filter((name) => !Object.hasOwn(FRAMEWORK_METHODS, name));
  if (unknownRequired.length) {
    const error = new Error(`Unknown framework capabilities: ${unknownRequired.join(', ')}`);
    error.code = 'FRAMEWORK_CAPABILITY_UNKNOWN';
    error.missing = unknownRequired;
    throw error;
  }

  const advertised = typeof adapter.capabilities === 'function' ? adapter.capabilities() : null;
  if (advertised !== null && (!Array.isArray(advertised) || advertised.some((name) => !Object.hasOwn(FRAMEWORK_METHODS, name)))) {
    const error = new Error('Framework adapter capabilities must be an array of known capability IDs');
    error.code = 'FRAMEWORK_CAPABILITY_DECLARATION_INVALID';
    throw error;
  }

  const required = new Set(requiredCapabilities);
  for (const name of advertised || []) required.add(name);

  const missing = [...required].filter((name) => typeof adapter[FRAMEWORK_METHODS[name]] !== 'function');
  if (missing.length) {
    const error = new Error(`Framework adapter missing capabilities: ${missing.join(', ')}`);
    error.code = 'FRAMEWORK_ADAPTER_CONTRACT';
    error.missing = missing;
    throw error;
  }
  return adapter;
}

export class FrameworkAdapterRegistry {
  constructor() { this.adapters = new Map(); }

  register(name, adapter, options = {}) {
    if (!name) throw new TypeError('adapter name is required');
    assertFrameworkAdapter(adapter, options);
    this.adapters.set(name, adapter);
    return adapter;
  }

  get(name) { return this.adapters.get(name) || null; }
  list() { return [...this.adapters.keys()]; }
}

export default FrameworkAdapterRegistry;
