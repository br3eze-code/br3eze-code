import crypto from 'node:crypto';
import eventBus from './eventBus.js';

export const CPO_CAPABILITIES = Object.freeze([
  'catalog.read',
  'inventory.read',
  'supplier.read',
  'quote.compare',
  'purchase.propose',
  'restock.propose',
]);

export const CFO_CAPABILITIES = Object.freeze([
  'ledger.read',
  'invoice.read',
  'reconciliation.propose',
  'budget.read',
  'variance.report',
  'purchase.cost.review',
  'purchase.approve',
]);

const CELL_ROLES = new Set(['cpo', 'procurement', 'cfo', 'accountant']);
const MUTATING_CAPABILITIES = new Set(['purchase.commit', 'payment.release', 'budget.allocate']);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function normalizeAgentCell(role) {
  if (!nonEmpty(role)) return null;
  const normalized = role
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (normalized === 'procurementagent' || normalized === 'purchasing') return 'cpo';
  if (normalized === 'accounting' || normalized === 'finance') return 'cfo';
  return normalized === 'procurement' ? 'cpo' : normalized === 'accountant' ? 'cfo' : normalized;
}

export function assertAgentosScope(scope = {}) {
  const required = ['tenantId', 'userId', 'projectId', 'domain'];
  const missing = required.filter(key => !nonEmpty(scope[key]));
  if (missing.length) {
    const error = new Error(`Missing AgentOS scope: ${missing.join(', ')}`);
    error.code = 'A2A_SCOPE_REQUIRED';
    throw error;
  }
  if (scope.siteId !== undefined && scope.siteId !== null && !nonEmpty(scope.siteId)) {
    const error = new Error('Invalid siteId');
    error.code = 'A2A_SCOPE_INVALID';
    throw error;
  }
  return Object.freeze({
    tenantId: scope.tenantId,
    userId: scope.userId,
    projectId: scope.projectId,
    domain: scope.domain,
    ...(scope.siteId ? { siteId: scope.siteId } : {}),
  });
}

export function validateAgentosA2AMessage(message = {}, options = {}) {
  const task = message.task || message;
  const agentos = task.agentos || message.agentos || {};
  const senderRole = normalizeAgentCell(agentos.fromRole || message.fromRole);
  const targetRole = normalizeAgentCell(agentos.toRole || message.toRole);
  const errors = [];

  if (!nonEmpty(message.sender)) errors.push('sender');
  if (!nonEmpty(message.recipient)) errors.push('recipient');
  if (!nonEmpty(task.taskId || message.taskId)) errors.push('taskId');
  if (!nonEmpty(task.capability)) errors.push('capability');
  if (!senderRole || !CELL_ROLES.has(senderRole)) errors.push('fromRole');
  if (!targetRole || !CELL_ROLES.has(targetRole)) errors.push('toRole');
  if (!nonEmpty(agentos.wbsId)) errors.push('wbsId');
  if (!nonEmpty(agentos.handoffId)) errors.push('handoffId');
  if (!nonEmpty(agentos.traceId || message.traceId)) errors.push('traceId');

  let scope;
  try {
    scope = assertAgentosScope(agentos.scope || agentos);
  } catch (error) {
    errors.push(error.code || 'scope');
  }

  const expected = options.expectedScope;
  if (expected && scope) {
    for (const key of ['tenantId', 'projectId', 'domain', 'siteId']) {
      if (expected[key] !== undefined && scope[key] !== expected[key]) errors.push(`scope.${key}`);
    }
  }

  const allowedCapabilities =
    targetRole === 'cpo' ? CPO_CAPABILITIES : targetRole === 'cfo' ? CFO_CAPABILITIES : [];
  if (
    (targetRole === 'cpo' || targetRole === 'cfo') &&
    !allowedCapabilities.includes(task.capability)
  ) {
    errors.push('capability_not_allowed_for_cell');
  }

  if (MUTATING_CAPABILITIES.has(task.capability) && !agentos.approval?.approvalId) {
    errors.push('approval_required');
  }

  return {
    valid: errors.length === 0,
    errors,
    scope,
    senderRole,
    targetRole,
    taskId: task.taskId || message.taskId || null,
  };
}

export function emitAgentosA2AEvent(type, payload = {}) {
  const event = {
    eventId: crypto.randomUUID(),
    eventType: type,
    createdAt: new Date().toISOString(),
    ...payload,
  };
  eventBus.emit(type, event);
  eventBus.emit('a2a:event', event);
  return event;
}

export const RESTOCK_STATES = Object.freeze([
  'proposed',
  'catalog_verified',
  'availability_verified',
  'technical_review',
  'cost_review',
  'qa_review',
  'budget_approved',
  'purchase_approved',
  'committed',
  'rejected',
]);

export const RESTOCK_GATES = Object.freeze({
  catalog_verified: { role: 'cpo', evidence: ['productId', 'description', 'requestedQuantity'] },
  availability_verified: { role: 'cpo', evidence: ['availabilitySource', 'availableQuantity'] },
  technical_review: { role: 'engineer', evidence: ['compatibilityEvidence'] },
  cost_review: { role: 'cfo', evidence: ['currency', 'unitCost', 'totalCost', 'budgetRef'] },
  qa_review: { role: 'qa', evidence: ['acceptanceCriteria', 'evidenceRefs'] },
  budget_approved: { role: 'budget_owner', evidence: ['approvalId'] },
  purchase_approved: { role: 'authorized_approver', evidence: ['approvalId'] },
  committed: { role: 'procurement', evidence: ['purchaseOrderId'] },
});

export function validateRestockTransition({ proposal, nextState, actor, evidence = {} }) {
  const current = proposal?.state || 'proposed';
  if (!RESTOCK_STATES.includes(nextState)) return { valid: false, code: 'RESTOCK_STATE_INVALID' };
  if (nextState === 'committed' && proposal?.state !== 'purchase_approved') {
    return { valid: false, code: 'PURCHASE_APPROVAL_REQUIRED' };
  }
  const gate = RESTOCK_GATES[nextState];
  if (
    gate &&
    normalizeAgentCell(actor?.role) !== gate.role &&
    gate.role !== 'qa' &&
    gate.role !== 'budget_owner' &&
    gate.role !== 'authorized_approver'
  ) {
    return { valid: false, code: 'RESTOCK_GATE_ROLE_REQUIRED', requiredRole: gate.role };
  }
  const missing = gate
    ? gate.evidence.filter(
        key => evidence[key] === undefined || evidence[key] === null || evidence[key] === ''
      )
    : [];
  if (missing.length) return { valid: false, code: 'RESTOCK_EVIDENCE_REQUIRED', missing };
  return { valid: true, from: current, to: nextState };
}

export function publishRestockTransition(payload) {
  return emitAgentosA2AEvent('restock.transitioned', payload);
}

export default {
  CPO_CAPABILITIES,
  CFO_CAPABILITIES,
  RESTOCK_STATES,
  RESTOCK_GATES,
  assertAgentosScope,
  normalizeAgentCell,
  validateAgentosA2AMessage,
  validateRestockTransition,
  publishRestockTransition,
};
