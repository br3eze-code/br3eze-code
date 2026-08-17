const CONTRACTS = new Map([
  ['agentos.work.v1', ['id', 'tenantId', 'status']],
  ['agentos.loop.v1', ['id', 'workId', 'state']],
  ['agentos.action.v1', ['id', 'workId', 'capability', 'scope']],
  ['agentos.evidence.v1', ['id', 'actionId', 'kind', 'createdAt']],
  ['agentos.authority.v1', ['principalId', 'tenantId', 'decision']],
  ['agentos.policy.v1', ['id', 'version', 'decision']],
  ['agentos.adapter.v1', ['id', 'version', 'capabilities', 'operations', 'health']],
  ['agentos.plugin.v1', ['id', 'version', 'capabilities', 'operations', 'health']],
]);

const VERSION_PATTERN = /^agentos\.[a-z-]+\.v\d+$/;

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function validate(contractId, value) {
  if (!CONTRACTS.has(contractId)) {
    throw new Error(`Unknown AgentOS contract: ${contractId}`);
  }
  assertRecord(value, contractId);
  const missing = CONTRACTS.get(contractId).filter((field) => {
    const item = value[field];
    return item === undefined || item === null || item === '';
  });
  if (missing.length) {
    throw new TypeError(`${contractId} missing required fields: ${missing.join(', ')}`);
  }
  if (contractId.endsWith('.adapter.v1') || contractId.endsWith('.plugin.v1')) {
    if (!Array.isArray(value.capabilities) || !Array.isArray(value.operations)) {
      throw new TypeError(`${contractId} capabilities and operations must be arrays`);
    }
    if (typeof value.health !== 'object' || value.health === null) {
      throw new TypeError(`${contractId} health must be an object`);
    }
  }
  return Object.freeze({ ...value, contract: contractId });
}

function register(contractId, schema) {
  if (!VERSION_PATTERN.test(contractId)) {
    throw new TypeError(`Invalid versioned contract id: ${contractId}`);
  }
  assertRecord(schema, contractId);
  const required = Array.isArray(schema.required) ? schema.required : [];
  CONTRACTS.set(contractId, [...new Set(required)]);
  return contractId;
}

function has(contractId) {
  return CONTRACTS.has(contractId);
}

function list() {
  return [...CONTRACTS.entries()].map(([id, required]) => ({ id, required: [...required] }));
}

function isCompatible(expected, actual) {
  if (!has(expected) || !has(actual)) return false;
  const expectedVersion = Number(expected.match(/\.v(\d+)$/)?.[1]);
  const actualVersion = Number(actual.match(/\.v(\d+)$/)?.[1]);
  const expectedName = expected.replace(/\.v\d+$/, '');
  const actualName = actual.replace(/\.v\d+$/, '');
  return expectedName === actualName && actualVersion >= expectedVersion;
}

export { CONTRACTS, validate, register, has, list, isCompatible };
export default { validate, register, has, list, isCompatible };
