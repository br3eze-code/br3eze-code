export const WBS = Object.freeze([
  ['WBS-00', 'IntakeAgent'],
  ['WBS-10', 'CapabilityAgent'],
  ['WBS-20', 'CompatibilityAgent'],
  ['WBS-30', 'PermissionAgent'],
  ['WBS-40', 'SecurityAgent'],
  ['WBS-50', 'LifecycleAgent'],
  ['WBS-60', 'DomainBoundaryAgent'],
  ['WBS-70', 'TestAgent'],
  ['WBS-80', 'EvidenceAgent'],
  ['WBS-90', 'ReleaseAgent'],
]);

const fail = (code, message, details = {}) => ({
  ok: false,
  code,
  message,
  ...details,
});

export function validateRequest(request = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return fail('INVALID_REQUEST', 'Request must be an object');
  }
  if (typeof request.action !== 'string' || !request.action.trim()) {
    return fail('INVALID_ACTION', 'A non-empty action is required');
  }
  return { ok: true };
}

export function capabilityResult(action, supported, reason = undefined) {
  return {
    ok: Boolean(supported),
    supported: Boolean(supported),
    action,
    ...(reason ? { reason } : {}),
    ...(supported ? {} : { code: 'UNSUPPORTED' }),
  };
}

export function denyUnlessAuthorized(context = {}) {
  if (context.authorized === true && typeof context.actorId === 'string' && context.actorId) {
    return { ok: true };
  }
  return fail('AUTHORIZATION_REQUIRED', 'Privileged operation requires an authenticated actor');
}

export function safeExecute(request, executor, context = {}) {
  const valid = validateRequest(request);
  if (!valid.ok) return valid;
  if (typeof executor !== 'function') return fail('INVALID_EXECUTOR', 'Executor is required');
  try {
    return executor(request, context);
  } catch (error) {
    return fail('EXECUTION_FAILED', error instanceof Error ? error.message : String(error));
  }
}

export function createWbsManifest(plugin, version, capabilities = []) {
  return Object.freeze({
    schema: 'agentos.wbs.v1',
    plugin,
    version,
    agents: WBS.map(([id, name]) => ({ id, name })),
    capabilities: [...capabilities],
  });
}
