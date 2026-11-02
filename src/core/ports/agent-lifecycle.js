/**
 * Provider-neutral agent lifecycle port.
 *
 * Agent role profiles are templates, not agent identities or grants. Persistent
 * instances are created through a tenant-scoped identity store. The host injects
 * the canonical AgentRuntime, authorization and durable approval services.
 */
import { getAgentRoleProfile, normalizeAgentRole } from '../agent-role-profiles.js';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
}

function requireIdentity(context = {}) {
  if (typeof context.tenantId !== 'string' || !context.tenantId.trim() ||
      typeof context.userId !== 'string' || !context.userId.trim()) {
    throw new Error('AGENT_IDENTITY_REQUIRED');
  }
}

function requiredString(value, name, maxLength = 200) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new TypeError(`${name} exceeds ${maxLength} characters`);
  return normalized;
}

function toAgentKeyPart(value) {
  return value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Construct a safe identity definition. The database generates the immutable
 * UUID; the tenant-unique agent_key is derived from role + display name.
 * Effective grants are never accepted from the caller or inferred from role.
 */
export function normalizeAgentDefinition(definition = {}, context = {}) {
  requireIdentity(context);
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new TypeError('AGENT_DEFINITION_REQUIRED');
  }
  if (definition.tenantId && definition.tenantId !== context.tenantId) {
    throw new Error('AGENT_TENANT_SCOPE_VIOLATION');
  }
  if (definition.createdBy && definition.createdBy !== context.userId) {
    throw new Error('AGENT_CREATOR_SCOPE_VIOLATION');
  }
  for (const field of ['id', 'agentId', 'agentKey', 'capabilities', 'permissions', 'tools', 'resourceScopes', 'parentAgentId']) {
    if (Object.hasOwn(definition, field)) {
      const error = new Error('AGENT_AUTHORITY_SERVER_MANAGED');
      error.code = 'AGENT_AUTHORITY_SERVER_MANAGED';
      throw error;
    }
  }

  const name = requiredString(definition.name || definition.label, 'AGENT_NAME_REQUIRED', 80);
  const role = normalizeAgentRole(definition.role || definition.agentRole || definition.professionalRole);
  if (!role) {
    const error = new Error('AGENT_ROLE_UNSUPPORTED');
    error.code = 'AGENT_ROLE_UNSUPPORTED';
    throw error;
  }
  const profile = getAgentRoleProfile(role);
  const namePart = toAgentKeyPart(name);
  if (!namePart) throw new TypeError('AGENT_NAME_NOT_SLUGGABLE');

  const domain = requiredString(definition.domain || 'general', 'AGENT_DOMAIN_REQUIRED', 64).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(domain) ||
      (!profile.domains.includes('*') && !profile.domains.includes(domain))) {
    const error = new Error('AGENT_DOMAIN_NOT_ALLOWED_FOR_ROLE');
    error.code = 'AGENT_DOMAIN_NOT_ALLOWED_FOR_ROLE';
    throw error;
  }

  const allowedTypes = new Set(['autonomous', 'assistant', 'worker', 'orchestrator', 'service']);
  const agentType = definition.agentType || 'assistant';
  if (!allowedTypes.has(agentType)) throw new TypeError('AGENT_TYPE_INVALID');

  const description = typeof definition.description === 'string'
    ? definition.description.trim().slice(0, 500)
    : profile.description;
  const purpose = typeof definition.purpose === 'string'
    ? definition.purpose.trim().slice(0, 1000)
    : description;

  return Object.freeze({
    tenantId: context.tenantId,
    createdBy: context.userId,
    ownerUserId: context.userId,
    agentKey: `${role}:${namePart}`,
    name,
    role,
    domain,
    agentType,
    description,
    purpose,
    // These are profile hints stored for display/audit only. Authorization
    // checks agent_policies and never treats this array as an effective grant.
    capabilities: [...profile.capabilities],
    approvalRequired: [...profile.approvalRequired],
    domains: [...profile.domains],
    profileVersion: '1.0.0',
  });
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
    async get({ agentId, context = {} } = {}) {
      requireIdentity(context);
      if (typeof agentId !== 'string' || !agentId.trim()) throw new TypeError('AGENT_ID_REQUIRED');
      const request = Object.freeze({
        capability: 'agent.get',
        agentId: agentId.trim(),
        tenantId: context.tenantId,
        userId: context.userId,
        requestId: context.requestId || null,
      });
      if (!await authorize(request, context)) throw new Error('AGENT_GET_FORBIDDEN');
      const agent = await registry.get(request.agentId, context);
      if (!agent) return Object.freeze({ capability: 'agent.get', status: 'not_found', agentId: request.agentId });
      return Object.freeze({ capability: 'agent.get', status: 'found', agent });
    },

    async create({ definition, context = {} } = {}) {
      requireIdentity(context);
      const normalizedDefinition = normalizeAgentDefinition(definition, context);
      const request = Object.freeze({
        capability: 'agent.create',
        tenantId: context.tenantId,
        userId: context.userId,
        requestId: context.requestId || null,
        definition: normalizedDefinition,
      });
      if (!await authorize(request, context)) throw new Error('AGENT_CREATE_FORBIDDEN');
      if (!await requestApproval(request, context)) throw new Error('AGENT_CREATE_APPROVAL_REQUIRED');
      // The second argument is required by tenant-scoped adapters. Omitting it
      // caused the real Supabase registry adapter to fail with AGENT_TENANT_REQUIRED.
      const agent = await registry.create(normalizedDefinition, context);
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

    async call({ agentId, input, context = {} } = {}) {
      requireIdentity(context);
      if (typeof agentId !== 'string' || !agentId.trim()) throw new TypeError('AGENT_ID_REQUIRED');
      if (input === undefined) throw new TypeError('AGENT_INPUT_REQUIRED');
      const request = Object.freeze({
        capability: 'agent.call',
        agentId: agentId.trim(),
        tenantId: context.tenantId,
        userId: context.userId,
        requestId: context.requestId || null,
      });
      if (!await authorize(request, context)) throw new Error('AGENT_CALL_FORBIDDEN');
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
