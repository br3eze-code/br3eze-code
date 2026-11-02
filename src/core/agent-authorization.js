/**
 * Fail-closed authorization boundary for persistent AgentOS workload identities.
 * The host supplies an adapter that verifies the credential and loads the current
 * identity + effective policy from its authoritative store (e.g. Supabase).
 */
export class AgentAuthorizationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AgentAuthorizationError';
    this.code = code;
  }
}

export async function authorizeAgentTool({ authorizer, agentId, tenantId, userId, toolName, params = {}, context = {} }) {
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
  } catch (cause) {
    throw new AgentAuthorizationError('AGENT_AUTHORIZATION_UNAVAILABLE', 'Agent identity authorization could not be verified');
  }

  const identity = decision?.identity;
  const policy = decision?.policy;
  if (decision?.credentialValid !== true) {
    throw new AgentAuthorizationError('AGENT_CREDENTIAL_INVALID', 'Agent credential is missing, invalid, expired or revoked');
  }
  if (!identity || identity.id !== agentId || identity.tenantId !== tenantId) {
    throw new AgentAuthorizationError('AGENT_IDENTITY_SCOPE_MISMATCH', 'Agent identity does not belong to the authenticated tenant');
  }
  if (identity.status !== 'active') {
    throw new AgentAuthorizationError('AGENT_IDENTITY_INACTIVE', 'Agent identity is not active');
  }
  if (identity.expiresAt && Date.parse(identity.expiresAt) <= Date.now()) {
    throw new AgentAuthorizationError('AGENT_IDENTITY_EXPIRED', 'Agent identity has expired');
  }
  if (!policy || policy.active !== true || policy.effect !== 'allow') {
    throw new AgentAuthorizationError('AGENT_POLICY_DENIED', 'No active allow policy authorizes this agent');
  }
  const capabilities = Array.isArray(policy.capabilities) ? policy.capabilities : [];
  if (!capabilities.includes('*') && !capabilities.includes(toolName)) {
    throw new AgentAuthorizationError('AGENT_CAPABILITY_DENIED', `Agent policy does not grant tool: ${toolName}`);
  }

  return Object.freeze({
    agentId,
    tenantId,
    userId,
    policyId: policy.id || null,
    policyVersion: Number.isInteger(policy.version) ? policy.version : null,
  });
}
