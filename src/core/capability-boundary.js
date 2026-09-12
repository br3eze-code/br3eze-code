import { randomUUID } from 'node:crypto';

/**
 * Domain-neutral capability boundary.
 * Plugins, skills and domains may advertise capabilities, but the kernel only
 * executes a capability after scope, authorization, approval and lifecycle checks.
 */

const PHASES = Object.freeze(['plan', 'draft', 'approve', 'execute', 'observe', 'verify', 'complete']);
const RISK_LEVELS = Object.freeze(['low', 'medium', 'high', 'critical']);

function normalizeCapabilities(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

export function describeCapability({ id, domain = 'general', skill = null, tool = null, phase = 'plan', risk = 'low', requiresApproval = false, permissions = [] } = {}) {
  if (!id) throw new Error('capability id is required');
  if (!PHASES.includes(phase)) throw new Error(`invalid capability phase: ${phase}`);
  if (!RISK_LEVELS.includes(risk)) throw new Error(`invalid capability risk: ${risk}`);
  return Object.freeze({ id: String(id), domain: String(domain || 'general'), skill: skill ? String(skill) : null, tool: tool ? String(tool) : null, phase, risk, requiresApproval: Boolean(requiresApproval || (phase === 'execute' && risk !== 'low')), permissions: normalizeCapabilities(permissions) });
}

export function checkCapabilityBoundary(capability, context = {}, { phase = 'plan', approved = false } = {}) {
  const errors = [];
  if (!capability?.id) errors.push('capability_required');
  if (!PHASES.includes(phase)) errors.push('invalid_phase');
  if (capability && phase === 'execute' && capability.phase !== 'execute') errors.push('capability_not_executable');
  if (capability && phase === 'execute' && capability.requiresApproval && approved !== true) errors.push('approval_required');
  if (!context.tenantId) errors.push('tenant_scope_required');
  if (!context.userId && !context.actorId) errors.push('actor_required');
  const granted = normalizeCapabilities(context.authorizedCapabilities || context.capabilities);
  if (capability?.permissions?.length && !granted.includes('*')) {
    for (const permission of capability.permissions) if (!granted.includes(permission)) errors.push(`missing_permission:${permission}`);
  }
  return { allowed: errors.length === 0, errors };
}

export function createExecutionIntent({ taskId = null, wbsId = null, capability, context = {}, input = {}, phase = 'plan' } = {}) {
  const descriptor = describeCapability(capability);
  const boundary = checkCapabilityBoundary(descriptor, context, { phase, approved: context.approvalGranted === true });
  return Object.freeze({ intentId: `intent_${randomUUID()}`, taskId, wbsId, capability: descriptor, phase, input, scope: { tenantId: context.tenantId || null, domainId: context.domainId || null, siteId: context.siteId || null, userId: context.userId || context.actorId || null }, status: boundary.allowed ? (phase === 'execute' ? 'ready' : 'draft') : 'blocked', boundary });
}

export { PHASES, RISK_LEVELS, normalizeCapabilities };
export default { PHASES, RISK_LEVELS, describeCapability, checkCapabilityBoundary, createExecutionIntent, normalizeCapabilities };
