import { randomUUID } from 'node:crypto';

const DEFAULT_EXPIRY_MS = 15 * 60 * 1000;

function scopeValue(context, key, fallback = null) {
  return context?.[key] ?? context?.scope?.[key] ?? context?.scopes?.[key] ?? fallback;
}

function nowIso(clock) {
  return new Date(clock()).toISOString();
}

export class ApprovalGate {
  constructor({ clock = () => Date.now(), idFactory = () => `apr_${randomUUID()}`, expiryMs = DEFAULT_EXPIRY_MS, store = null } = {}) {
    this.clock = clock;
    this.idFactory = idFactory;
    this.expiryMs = expiryMs;
    this.store = store;
    this.requests = new Map();
    this.idempotency = new Map();
  }

  _get(approvalId) {
    return this.store?.get?.(approvalId) || this.requests.get(approvalId) || null;
  }

  _put(request) {
    this.requests.set(request.approvalId, request);
    this.store?.put?.(request.approvalId, request);
    return request;
  }

  _isExpired(request) {
    return Boolean(request?.expiresAt && Date.parse(request.expiresAt) <= this.clock());
  }

  inspect({ tool, context = {}, metadata = {} }) {
    if (!metadata.requiresApproval) return { allowed: true, status: 'not_required' };

    const tenantId = scopeValue(context, 'tenantId', context.tenant || null);
    const siteId = scopeValue(context, 'siteId');
    const nodeId = scopeValue(context, 'nodeId', scopeValue(context, 'routerId'));
    const action = metadata.action || tool;
    const idempotencyKey = metadata.idempotencyKey || context.idempotencyKey || null;
    const suppliedApproval = context.approval || null;
    const idempotencyRef = idempotencyKey ? `${tenantId || 'unscoped'}:${idempotencyKey}` : null;
    const existingApprovalId = suppliedApproval?.approvalId || (idempotencyRef ? this.store?.findByIdempotencyKey?.(idempotencyKey, tenantId) || this.idempotency.get(idempotencyRef) : null);
    const existing = existingApprovalId ? this._get(existingApprovalId) : null;

    if (existing && this._isExpired(existing)) {
      const expired = { ...existing, status: 'expired', expiredAt: nowIso(this.clock) };
      this._put(Object.freeze(expired));
      return { allowed: false, code: 'APPROVAL_EXPIRED', request: expired };
    }

    const approval = existing || suppliedApproval;
    if (!approval || approval.status !== 'approved') {
      const approvalId = approval?.approvalId || this.idFactory();
      const request = {
        approvalId,
        tool,
        action,
        tenantId,
        siteId,
        nodeId,
        projectId: context.projectId || null,
        taskId: context.taskId || context.ticketId || null,
        requestedBy: context.actor || context.actorId || context.userId || null,
        idempotencyKey,
        status: 'pending',
        requestedAt: nowIso(this.clock),
        expiresAt: new Date(this.clock() + this.expiryMs).toISOString(),
        preview: metadata.preview || null
      };
      this._put(Object.freeze(request));
      if (idempotencyRef) this.idempotency.set(idempotencyRef, approvalId);
      return { allowed: false, code: 'APPROVAL_REQUIRED', request: Object.freeze({ ...request }) };
    }

    const request = this._get(approval.approvalId);
    if (request && request.tool !== tool) return { allowed: false, code: 'APPROVAL_SCOPE_MISMATCH', message: 'Approval is for a different tool' };
    if (request && request.action !== action) return { allowed: false, code: 'APPROVAL_SCOPE_MISMATCH', message: 'Approval is for a different action' };
    if (request && request.tenantId !== tenantId) return { allowed: false, code: 'APPROVAL_SCOPE_MISMATCH', message: 'Approval is for a different tenant' };
    if (request && request.siteId && request.siteId !== siteId) return { allowed: false, code: 'APPROVAL_SCOPE_MISMATCH', message: 'Approval is for a different site' };
    if (request && request.nodeId && request.nodeId !== nodeId) return { allowed: false, code: 'APPROVAL_SCOPE_MISMATCH', message: 'Approval is for a different router' };
    return { allowed: true, status: 'approved', approvalId: approval.approvalId };
  }

  approve(approvalId, { approvedBy, tenantId, siteId = null, nodeId = null }) {
    const request = this._get(approvalId);
    if (!request) throw new Error(`Unknown approval: ${approvalId}`);
    if (request.tenantId !== tenantId || (request.siteId && request.siteId !== siteId) || (request.nodeId && request.nodeId !== nodeId)) throw new Error('Approval scope mismatch');
    if (this._isExpired(request)) {
      const expired = Object.freeze({ ...request, status: 'expired', expiredAt: nowIso(this.clock) });
      this._put(expired);
      throw new Error('Approval expired');
    }
    const approved = Object.freeze({ ...request, status: 'approved', approvedBy, approvedAt: nowIso(this.clock) });
    return this._put(approved);
  }

  deny(approvalId, { deniedBy, tenantId, siteId = null, nodeId = null, reason = 'Approval denied' }) {
    const request = this._get(approvalId);
    if (!request) throw new Error(`Unknown approval: ${approvalId}`);
    if (request.tenantId !== tenantId || (request.siteId && request.siteId !== siteId) || (request.nodeId && request.nodeId !== nodeId)) throw new Error('Approval scope mismatch');
    const denied = Object.freeze({ ...request, status: 'denied', deniedBy, reason, deniedAt: nowIso(this.clock) });
    return this._put(denied);
  }
}
