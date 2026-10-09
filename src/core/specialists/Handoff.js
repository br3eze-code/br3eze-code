function required(value, name) {
  if (!value || typeof value !== 'string') throw new Error(`${name} is required`);
  return value;
}

export function createHandoff({
  from,
  to,
  workPackageId,
  requestedAction,
  tenantId,
  userId,
  evidence = [],
  acceptanceCriteria = [],
  payload = {},
  riskLevel = 'medium',
  requiresApproval = false,
  createdAt = new Date().toISOString(),
} = {}) {
  return Object.freeze({
    handoffId: `handoff_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    from: required(from, 'from'),
    to: required(to, 'to'),
    workPackageId: required(workPackageId, 'workPackageId'),
    requestedAction: required(requestedAction, 'requestedAction'),
    tenantId: required(tenantId, 'tenantId'),
    userId: required(userId, 'userId'),
    evidence: Object.freeze(Array.isArray(evidence) ? [...evidence] : []),
    acceptanceCriteria: Object.freeze(Array.isArray(acceptanceCriteria) ? [...acceptanceCriteria] : []),
    payload: Object.freeze({ ...payload }),
    riskLevel,
    requiresApproval: Boolean(requiresApproval),
    status: 'requested',
    createdAt,
  });
}

export function assertHandoffScope(handoff, context = {}) {
  if (!handoff || handoff.tenantId !== context.tenantId) throw new Error('Handoff is outside the authorized tenant scope');
  if (handoff.userId !== context.userId && !context.canAcceptDelegatedHandoff) throw new Error('Handoff actor is not authorized for this context');
  return handoff;
}

export default createHandoff;

