/**
 * Versioned, host-neutral request contract shared by AgentOS clients.
 * Keep this module free of Node, Cordova, vendor, and domain imports.
 */
export const AGENT_RUNTIME_CONTRACT_VERSION = '1.0';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function optionalString(value, field) {
  if (value !== undefined && value !== null && (typeof value !== 'string' || !value.trim())) {
    throw new TypeError(field + ' must be a non-empty string when provided');
  }
}

export function createRuntimeRequest({
  sessionId,
  input,
  context = {},
  capabilities = [],
  checkpoint = null,
  requestId,
  tenantId,
  identity,
  idempotencyKey,
  approvalRef,
  traceId,
} = {}) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw new TypeError('sessionId is required');
  }
  if (input === undefined || input === null) {
    throw new TypeError('input is required');
  }
  if (!isRecord(context)) throw new TypeError('context must be an object');
  if (!Array.isArray(capabilities) || capabilities.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new TypeError('capabilities must be an array of non-empty strings');
  }

  for (const [field, value] of Object.entries({
    requestId, tenantId, identity, idempotencyKey, approvalRef, traceId,
  })) optionalString(value, field);

  const metadata = Object.freeze({
    ...(requestId ? { requestId } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(identity ? { identity } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(approvalRef ? { approvalRef } : {}),
    ...(traceId ? { traceId } : {}),
  });

  return Object.freeze({
    contractVersion: AGENT_RUNTIME_CONTRACT_VERSION,
    sessionId: sessionId.trim(),
    input,
    context: Object.freeze({ ...context }),
    capabilities: Object.freeze([...capabilities]),
    checkpoint,
    metadata,
  });
}
