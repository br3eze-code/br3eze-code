import crypto from 'node:crypto';
import { assertProjectScope, requirePermission } from './project-manager-context.js';

const ROLE_POLICIES = Object.freeze({
  procurement: {
    permission: 'wbs.delegate.procurement',
    allowedActions: ['prepare_vendor_request', 'compare_quotes', 'draft_purchase_order'],
    prohibitedFields: ['credentials', 'payment_authorization', 'other_tenants', 'unapproved_budget_change'],
    mutationApproval: true,
  },
  video: {
    permission: 'wbs.delegate.video',
    allowedActions: ['draft_video_brief', 'redraft_video', 'prepare_channel_render'],
    prohibitedFields: ['raw_cctv_streams', 'private_identities', 'credentials', 'publish_without_approval'],
    mutationApproval: true,
  },
});

export function createRoleBoundHandoff({ context, projectId, packageId, specialist, action, inputScope = [], summary = '' }) {
  assertProjectScope(context, projectId);
  const policy = ROLE_POLICIES[specialist];
  if (!policy) throw Object.assign(new Error('Unsupported specialist role'), { statusCode: 400, code: 'ROLE_NOT_SUPPORTED' });
  requirePermission(context, policy.permission);
  if (!policy.allowedActions.includes(action)) {
    throw Object.assign(new Error('Action is not allowed for specialist role'), { statusCode: 403, code: 'ACTION_NOT_ALLOWED' });
  }
  const handoffId = `HO-${crypto.randomUUID()}`;
  return {
    handoffId,
    tenantId: context.tenantId,
    projectId,
    packageId: packageId || context.wbsPackageId || null,
    from: 'project-manager',
    to: `${specialist}-specialist`,
    specialist,
    action,
    inputScope: [...new Set(inputScope)],
    prohibitedScope: policy.prohibitedFields,
    approvalRequired: policy.mutationApproval,
    status: 'awaiting_review',
    createdBy: context.userId,
    sourceChannel: context.channel,
    sourceConversationId: context.conversationId,
    summary,
    createdAt: new Date().toISOString(),
  };
}

export function createApproval({ context, handoffId, action, argumentsValue, ttlMs = 15 * 60 * 1000 }) {
  const now = Date.now();
  return {
    approvalId: `APR-${crypto.randomUUID()}`,
    tenantId: context.tenantId,
    projectId: context.projectId,
    handoffId,
    action,
    argumentsHash: crypto.createHash('sha256').update(JSON.stringify(argumentsValue || {})).digest('hex'),
    requestedBy: context.userId,
    channel: context.channel,
    status: 'pending',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
}

export function confirmApproval(approval, context, now = Date.now()) {
  if (!approval || approval.tenantId !== context.tenantId || approval.requestedBy !== context.userId) {
    throw Object.assign(new Error('Approval is outside the execution scope'), { statusCode: 403, code: 'APPROVAL_SCOPE_MISMATCH' });
  }
  if (approval.status !== 'pending') throw Object.assign(new Error('Approval is no longer pending'), { statusCode: 409, code: 'APPROVAL_NOT_PENDING' });
  if (new Date(approval.expiresAt).getTime() <= now) {
    approval.status = 'expired';
    throw Object.assign(new Error('Approval has expired'), { statusCode: 410, code: 'APPROVAL_EXPIRED' });
  }
  approval.status = 'approved';
  approval.approvedBy = context.userId;
  approval.approvedAt = new Date(now).toISOString();
  return approval;
}

export { ROLE_POLICIES };
