import { randomUUID } from 'node:crypto';

export class ApprovalGate {
  constructor({ clock = () => Date.now(), idFactory = () => `apr_${randomUUID()}` } = {}) {
    this.clock = clock;
    this.idFactory = idFactory;
    this.requests = new Map();
  }

  inspect({ tool, context = {}, metadata = {} }) {
    if (!metadata.requiresApproval) return { allowed: true, status: 'not_required' };

    const approval = context.approval;
    if (!approval || approval.status !== 'approved') {
      const approvalId = approval?.approvalId || this.idFactory();
      const request = {
        approvalId,
        tool,
        tenantId: context.tenantId || context.tenant || null,
        projectId: context.projectId || null,
        taskId: context.taskId || context.ticketId || null,
        requestedBy: context.actor || context.actorId || context.userId || null,
        status: 'pending',
        requestedAt: new Date(this.clock()).toISOString(),
      };
      this.requests.set(approvalId, request);
      return {
        allowed: false,
        code: 'APPROVAL_REQUIRED',
        request: Object.freeze({ ...request }),
      };
    }

    const request = this.requests.get(approval.approvalId);
    if (request && request.tool !== tool) {
      return { allowed: false, code: 'APPROVAL_SCOPE_MISMATCH', message: 'Approval is for a different tool' };
    }
    if (request && request.tenantId !== (context.tenantId || context.tenant || null)) {
      return { allowed: false, code: 'APPROVAL_SCOPE_MISMATCH', message: 'Approval is for a different tenant' };
    }
    return { allowed: true, status: 'approved', approvalId: approval.approvalId };
  }

  approve(approvalId, { approvedBy, tenantId }) {
    const request = this.requests.get(approvalId);
    if (!request) throw new Error(`Unknown approval: ${approvalId}`);
    if (request.tenantId !== tenantId) throw new Error('Approval tenant mismatch');
    const approved = Object.freeze({
      ...request,
      status: 'approved',
      approvedBy,
      approvedAt: new Date(this.clock()).toISOString(),
    });
    this.requests.set(approvalId, approved);
    return approved;
  }

  deny(approvalId, { deniedBy, tenantId, reason = 'Approval denied' }) {
    const request = this.requests.get(approvalId);
    if (!request) throw new Error(`Unknown approval: ${approvalId}`);
    if (request.tenantId !== tenantId) throw new Error('Approval tenant mismatch');
    const denied = Object.freeze({
      ...request,
      status: 'denied',
      deniedBy,
      reason,
      deniedAt: new Date(this.clock()).toISOString(),
    });
    this.requests.set(approvalId, denied);
    return denied;
  }
}
