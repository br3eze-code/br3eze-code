export const FRAMEWORK_CONTRACT = Object.freeze([
  'agent.create', 'agent.run', 'agent.handoff', 'agent.child',
  'workflow.define', 'workflow.run', 'workflow.resume',
  'tool.register', 'tool.execute', 'guardrail.check',
  'memory.read', 'memory.write', 'trace.read', 'evaluation.run',
]);

export function assertFrameworkAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('framework adapter must be an object');
  const missing = FRAMEWORK_CONTRACT.filter((name) => typeof adapter[name.replace('.', '_')] !== 'function');
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
  register(name, adapter) { if (!name) throw new TypeError('adapter name is required'); assertFrameworkAdapter(adapter); this.adapters.set(name, adapter); return adapter; }
  get(name) { return this.adapters.get(name) || null; }
  list() { return [...this.adapters.keys()]; }
}

export default FrameworkAdapterRegistry;
