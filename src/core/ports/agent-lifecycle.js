/**
 * Provider-neutral agent lifecycle port.
 *
 * This is a capability boundary, not an execution engine. The host injects the
 * canonical AgentRuntime as executeAgent and chooses a registry/persistence
 * adapter. Tenant identity is server-derived and every mutation is authorized.
 */
function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
}

function requireIdentity(context = {}) {
  if (!context.tenantId || !context.userId) {
    throw new Error('AGENT_IDENTITY_REQUIRED');
  }
}

export function createAgentLifecyclePort({
  registry,
  executeAgent,
  authorize,
  requestApproval,
} = {}) {
  if (!registry || typeof registry.get !== 'function' ||
      typeof registry.create !== 'function' || typeof registry.remove !== 'function') {
    throw new TypeError('registry must implement get/create/remove');
  }
  requireFunction(executeAgent, 'executeAgent');
  requireFunction(authorize, 'authorize');
  requireFunction(requestApproval, 'requestApproval');

  return Object.freeze({
    async create({ definition, context = {} } = {}) {
      requireIdentity(context);
      if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
        throw new TypeError('AGENT_DEFINITION_REQUIRED');
      }
      const request = Object.freeze({
        capability: 'agent.create',
        tenantId: context.tenantId,
        userId: context.userId,
        requestId: context.requestId || null,
        definition,
      });
      if (!await authorize(request, context)) throw new Error('AGENT_CREATE_FORBIDDEN');
      if (!await requestApproval(request, context)) throw new Error('AGENT_CREATE_APPROVAL_REQUIRED');
      const agent = await registry.create({ ...definition, tenantId: context.tenantId, createdBy: context.userId });
      return Object.freeze({ capability: 'agent.create', status: 'created', agent });
    },

    async run({ agentId, input, context = {} } = {}) {
      requireIdentity(context);
      if (typeof agentId !== 'string' || !agentId.trim()) throw new TypeError('AGENT_ID_REQUIRED');
      if (input === undefined) throw new TypeError('AGENT_INPUT_REQUIRED');
      const request = Object.freeze({
        capability: 'agent.run',
        agentId: agentId.trim(),
        tenantId: context.tenantId,
        userId: context.userId,
        requestId: context.requestId || null,
      });
      if (!await authorize(request, context)) throw new Error('AGENT_RUN_FORBIDDEN');
      const agent = await registry.get(request.agentId, context);
      if (!agent) throw new Error('AGENT_NOT_FOUND');
      return executeAgent({ agent, input, context: { ...context, tenantId: context.tenantId, userId: context.userId } });
    },

    async remove({ agentId, reason, context = {} } = {}) {
      requireIdentity(context);
      if (typeof agentId !== 'string' || !agentId.trim()) throw new TypeError('AGENT_ID_REQUIRED');
      if (typeof reason !== 'string' || !reason.trim()) throw new TypeError('AGENT_REMOVE_REASON_REQUIRED');
      const request = Object.freeze({
        capability: 'agent.remove',
        agentId: agentId.trim(),
        reason: reason.trim(),
        tenantId: context.tenantId,
        userId: context.userId,
        requestId: context.requestId || null,
      });
      if (!await authorize(request, context)) throw new Error('AGENT_REMOVE_FORBIDDEN');
      if (!await requestApproval(request, context)) throw new Error('AGENT_REMOVE_APPROVAL_REQUIRED');
      const agent = await registry.get(request.agentId, context);
      if (!agent) return Object.freeze({ capability: 'agent.remove', status: 'not_found', agentId: request.agentId });
      const removed = await registry.remove(request.agentId, context);
      return Object.freeze({ capability: 'agent.remove', status: removed ? 'removed' : 'not_found', agentId: request.agentId });
    },
  });
}

export default createAgentLifecyclePort;
