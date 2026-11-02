/**
 * Canonical fail-closed authorization boundary for persistent AgentOS agents.
 * The host adapter must verify the credential and load current identity,
 * active human membership, effective policy and (when requested) resource scope.
 */
export class AgentAuthorizationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AgentAuthorizationError';
    this.code = code;
  }
}

export async function authorizeAgentTool({
  authorizer, agentId, tenantId, userId, toolName, params = {}, context = {},
}) {
  if (!agentId || typeof agentId !== 'string') {
    throw new AgentAuthorizationError('AGENT_ID_REQUIRED', 'Agent principal requires a persistent agentId');
  }
  if (!tenantId || !userId || !toolName) {
    throw new AgentAuthorizationError('AGENT_CONTEXT_INCOMPLETE', 'Agent authorization requires tenant, user and tool context');
  }
  if (typeof authorizer !== 'function') {
    throw new AgentAuthorizationError('AGENT_AUTHORIZER_UNAVAILABLE', 'Agent execution is disabled: no identity authorizer is configured');
  }

  let decision;
  try {
    decision = await authorizer({ agentId, tenantId, userId, toolName, params, context });
  } catch {
    throw new AgentAuthorizationError('AGENT_AUTHORIZATION_UNAVAILABLE', 'Agent identity authorization could not be verified');
  }

  if (decision?.credentialValid !== true) {
    throw new AgentAuthorizationError('AGENT_CREDENTIAL_INVALID', 'Agent credential is missing, invalid, expired or revoked');
  }

  const identity = decision.identity;
  if (!identity || identity.id !== agentId || identity.tenantId !== tenantId) {
    throw new AgentAuthorizationError('AGENT_IDENTITY_SCOPE_MISMATCH', 'Agent identity does not belong to the authenticated tenant');
  }
  if (identity.status !== 'active') {
    throw new AgentAuthorizationError('AGENT_IDENTITY_INACTIVE', 'Agent identity is not active');
  }
  if (identity.expiresAt && (!Number.isFinite(Date.parse(identity.expiresAt)) || Date.parse(identity.expiresAt) <= Date.now())) {
    throw new AgentAuthorizationError('AGENT_IDENTITY_EXPIRED', 'Agent identity has expired');
  }

  // Never trust a role supplied by the model, request body or agent context.
  // The adapter must prove the human caller's current membership in this tenant.
  const membership = decision.membership;
  if (
    !membership ||
    membership.userId !== userId ||
    membership.tenantId !== tenantId ||
    membership.status !== 'active' ||
    typeof membership.role !== 'string' ||
    !membership.role
  ) {
    throw new AgentAuthorizationError('AGENT_MEMBERSHIP_DENIED', 'The requesting user has no verified active membership in this tenant');
  }

  const policy = decision.policy;
  if (!policy || policy.active !== true || policy.effect !== 'allow') {
    throw new AgentAuthorizationError('AGENT_POLICY_DENIED', 'No active allow policy authorizes this agent');
  }

  // Exact grants only. A wildcard would silently turn a narrow agent into an administrator.
  const capabilities = Array.isArray(policy.capabilities) ? policy.capabilities : [];
  if (!capabilities.includes(toolName)) {
    throw new AgentAuthorizationError('AGENT_CAPABILITY_DENIED', `Agent policy does not grant tool: ${toolName}`);
  }

  const resourceId = context.resourceId || context.resource_id ||
    params.resourceId || params.resource_id || params.resource?.id || null;
  if (resourceId && decision.resourceAuthorized !== true) {
    throw new AgentAuthorizationError('AGENT_RESOURCE_SCOPE_DENIED', 'The policy adapter did not authorize this resource within the tenant');
  }

  return Object.freeze({
    agentId,
    tenantId,
    userId,
    membershipId: membership.id || null,
    membershipRole: membership.role,
    policyId: policy.id || null,
    policyVersion: Number.isInteger(policy.version) ? policy.version : null,
    resourceId,
  });
}
