import { randomUUID } from 'node:crypto';
import { buildExecutionContext, withExecutionContext } from './execution-context.js';

export const CONTEXT_TYPES = Object.freeze({
  INTERACTION: 'interaction',
  TASK: 'task',
  EVENT: 'event',
  DEVICE: 'device',
  ANALYSIS: 'analysis',
  COMMERCE: 'commerce',
});

const MUTATING_CONTEXT_TYPES = new Set(['task', 'commerce', 'device']);

function cleanEdges(edges = []) {
  return edges
    .filter((edge) => edge && edge.from && edge.to && edge.type)
    .map((edge) => ({
      from: String(edge.from),
      to: String(edge.to),
      type: String(edge.type),
      scope: {
        tenantId: edge.scope?.tenantId || null,
        siteId: edge.scope?.siteId || null,
        domain: edge.scope?.domain || null,
      },
      confidence: Number.isFinite(Number(edge.confidence)) ? Number(edge.confidence) : 1,
      source: edge.source ? String(edge.source) : 'agentos',
    }));
}

export function createNeuralLinks(context, links = []) {
  const scope = { tenantId: context.tenantId, siteId: context.siteId, domain: context.domain };
  return cleanEdges(links).map((edge) => ({
    ...edge,
    scope: {
      ...scope,
      ...Object.fromEntries(Object.entries(edge.scope || {}).filter(([, value]) => value != null && value !== '')),
    },
  }));
}

export function normalizeBotContext(input = {}, options = {}) {
  const contextType = String(options.contextType || input.contextType || CONTEXT_TYPES.INTERACTION).toLowerCase();
  if (!Object.values(CONTEXT_TYPES).includes(contextType)) {
    throw Object.assign(new Error(`Unsupported context type: ${contextType}`), { code: 'CONTEXT_TYPE_INVALID', status: 400 });
  }
  const base = buildExecutionContext(input);
  const context = {
    ...base,
    contextType,
    requestId: String(input.requestId || randomUUID()),
    traceId: String(input.traceId || input.requestId || randomUUID()),
    intent: input.intent ? String(input.intent) : null,
    domainId: base.domainId || base.domain || null,
    entities: input.entities && typeof input.entities === 'object' ? { ...input.entities } : {},
    permissions: [...new Set([
      ...(Array.isArray(input.permissions) ? input.permissions : []),
      ...(Array.isArray(base.authorizedCapabilities) ? base.authorizedCapabilities : []),
    ])],
    capabilities: [...new Set([
      ...(Array.isArray(input.capabilities) ? input.capabilities : []),
      ...(Array.isArray(base.authorizedCapabilities) ? base.authorizedCapabilities : []),
    ])],
    neuralLinks: [],
    privacy: {
      locationGranted: base.locationPermission === true,
      tenantScoped: Boolean(base.tenantId),
      identityLinked: Boolean(base.userId),
      mutationApprovalRequired: MUTATING_CONTEXT_TYPES.has(contextType),
    },
  };
  context.neuralLinks = createNeuralLinks(context, input.neuralLinks || []);
  return context;
}

export function assertBotContext(context, options = {}) {
  if (!context || typeof context !== 'object') throw Object.assign(new Error('Bot context is required'), { code: 'CONTEXT_REQUIRED', status: 400 });
  if (options.requireIdentity !== false && !context.userId) throw Object.assign(new Error('Authenticated user context is required'), { code: 'IDENTITY_REQUIRED', status: 401 });
  if (options.requireTenant !== false && !context.tenantId) throw Object.assign(new Error('Tenant scope is required'), { code: 'TENANT_SCOPE_REQUIRED', status: 403 });
  if (options.requireSite && !context.siteId) throw Object.assign(new Error('Site scope is required'), { code: 'SITE_SCOPE_REQUIRED', status: 403 });
  if (options.mutation && context.privacy?.mutationApprovalRequired && context.approvalGranted !== true) {
    throw Object.assign(new Error('Explicit approval is required for this mutation'), { code: 'APPROVAL_REQUIRED', status: 403 });
  }
  return context;
}

export function patchBotContext(context, patch = {}) {
  return normalizeBotContext({ ...context, ...patch, userDoc: patch.userDoc || context?.userDoc }, { contextType: patch.contextType || context?.contextType });
}

export { buildExecutionContext, withExecutionContext };
export default { CONTEXT_TYPES, normalizeBotContext, assertBotContext, patchBotContext, createNeuralLinks };
