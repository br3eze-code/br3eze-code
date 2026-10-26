import crypto from 'node:crypto';
import { requirePersistenceProvider } from './persistence.js';
import { dispatchNotification } from './notification-port.js';

const PREFIX = 'agentos:approval:';
const now = () => new Date().toISOString();

/**
 * Provider-neutral HITL requests. Persistence adapters must implement get/set and
 * atomic compareAndSet(key, expectedStatus, nextRecord) for single-use approvals.
 * Approval is fail-closed when atomic transitions are unavailable.
 */
export class ApprovalGate {
  constructor({ persistence = requirePersistenceProvider, notify = dispatchNotification, ttlMs = 30 * 60 * 1000 } = {}) {
    this.persistence = persistence;
    this.notify = notify;
    this.ttlMs = ttlMs;
  }

  async request({ toolName, params, context = {} }) {
    const tenantId = context.tenantId || context.tenant_id;
    const userId = context.userId || context.user_id || context.uid;
    if (!tenantId || !userId) throw new Error('Authenticated tenant and user are required for approval requests');
    const db = this.persistence();
    if (typeof db.set !== 'function') throw new Error('Persistence provider must implement set(key, value)');
    const actionId = 'ACT_' + crypto.randomBytes(12).toString('hex').toUpperCase();
    const record = {
      actionId, toolName, params, tenantId, requestedBy: userId,
      status: 'PENDING', createdAt: now(), expiresAt: new Date(Date.now() + this.ttlMs).toISOString(),
      context: { tenantId, userId, domain: context.domain || null, roles: context.roles || [] },
    };
    await db.set(PREFIX + actionId, record);
    await this.notify({
      idempotencyKey: 'approval-request:' + actionId,
      channel: 'admin_channel',
      type: 'approval_required',
      message: `Approval required for ${toolName}. Action ID: ${actionId}. Tenant: ${tenantId}. Requested by: ${userId}.`,
      actionId, tenantId, toolName,
    });
    return { status: 'AWAITING_APPROVAL', actionId, toolName, expiresAt: record.expiresAt };
  }

  async decide({ actionId, decision, actor, tenantId, authorize }) {
    if (!['APPROVED', 'REJECTED'].includes(decision)) throw new TypeError('decision must be APPROVED or REJECTED');
    if (!actor || !tenantId || typeof authorize !== 'function' || !(await authorize({ actor, tenantId, actionId }))) {
      throw new Error('Approver is not authorized');
    }
    const db = this.persistence();
    if (typeof db.get !== 'function' || typeof db.compareAndSet !== 'function') {
      throw new Error('Persistence provider must implement get and atomic compareAndSet for approval decisions');
    }
    const key = PREFIX + actionId;
    const current = await db.get(key);
    if (!current || current.actionId !== actionId) throw new Error('Approval request not found');
    if (current.tenantId !== tenantId) throw new Error('Cross-tenant approval denied');
    if (current.status !== 'PENDING') throw new Error('Approval request is no longer pending');
    if (Date.parse(current.expiresAt) <= Date.now()) throw new Error('Approval request expired');
    const next = { ...current, status: decision, decidedAt: now(), decidedBy: actor };
    const changed = await db.compareAndSet(key, 'PENDING', next);
    if (!changed) throw new Error('Approval request was already decided');
    return next;
  }

  async resume({ actionId, actor, tenantId, authorize, execute }) {
    if (typeof execute !== 'function') throw new TypeError('execute callback is required');
    const approved = await this.decide({ actionId, decision: 'APPROVED', actor, tenantId, authorize });
    // Claim the approved request before executing; providers should use compareAndSet
    // for the APPROVED -> EXECUTING transition to prevent duplicate/replayed execution.
    const db = this.persistence();
    const executing = { ...approved, status: 'EXECUTING', executionStartedAt: now() };
    if (!(await db.compareAndSet(PREFIX + actionId, 'APPROVED', executing))) {
      throw new Error('Approval could not be claimed for execution');
    }
    try {
      const result = await execute(approved.toolName, approved.params, {
        tenantId: approved.tenantId, userId: approved.requestedBy,
        approvalGranted: true, approved: true, approvalId: actionId, approvedBy: actor,
      });
      await db.set(PREFIX + actionId, { ...executing, status: 'EXECUTED', executedAt: now(), result });
      return { actionId, status: 'EXECUTED', result };
    } catch (error) {
      await db.set(PREFIX + actionId, { ...executing, status: 'FAILED', failedAt: now(), error: error.message });
      throw error;
    }
  }
}
export default ApprovalGate;
