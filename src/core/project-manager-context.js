import crypto from 'node:crypto';

function required(value, name) {
  if (!value || typeof value !== 'string') throw new Error(`${name} is required`);
  return value;
}

export function getRequestIdentity(req = {}) {
  const firebase = req.firebaseUser || {};
  const userId = firebase.uid || req.user?.id || req.auth?.userId || req.headers?.['x-user-id'];
  const tenantId = firebase.tenantId || req.user?.tenantId || req.auth?.tenantId || req.headers?.['x-tenant-id'];
  if (!userId) throw Object.assign(new Error('Authenticated user is required'), { statusCode: 401, code: 'AUTHENTICATION_REQUIRED' });
  if (!tenantId) throw Object.assign(new Error('Tenant scope is required'), { statusCode: 403, code: 'TENANT_REQUIRED' });
  return {
    userId,
    tenantId,
    roles: firebase.roles || firebase.role ? [ ...(firebase.roles || []), ...(firebase.role ? [firebase.role] : []) ] : (req.user?.roles || []),
    permissions: firebase.permissions || req.user?.permissions || (req.headers?.['x-permissions'] ? String(req.headers['x-permissions']).split(',').map(value => value.trim()).filter(Boolean) : []),
  };
}

export function continuityKey({ tenantId, userId, channel, conversationId, projectId = 'inbox' }) {
  // Channel is deliberately excluded: a verified handoff may continue across PWA,
  // Telegram, or WhatsApp. Tenant, user, conversation, and project remain bound.
  return crypto.createHash('sha256')
    .update([tenantId, userId, conversationId, projectId].map(String).join(':'))
    .digest('hex');
}

export function createProjectManagerContext(req = {}, input = {}) {
  const identity = getRequestIdentity(req);
  const channel = input.channel || req.channel || req.headers?.['x-channel'] || 'pwa';
  const conversationId = input.conversationId || req.body?.conversationId || req.query?.conversationId || `${channel}:${identity.userId}`;
  const projectId = input.projectId || req.body?.projectId || req.params?.projectId || null;
  const sessionId = input.sessionId || req.body?.sessionId || req.headers?.['x-session-id'] || continuityKey({ ...identity, channel, conversationId, projectId: projectId || 'inbox' });
  return {
    requestId: input.requestId || req.id || crypto.randomUUID(),
    userId: identity.userId,
    tenantId: identity.tenantId,
    roles: [...new Set(identity.roles)],
    permissions: [...new Set(identity.permissions)],
    channel,
    conversationId,
    sessionId,
    projectId,
    wbsPackageId: input.wbsPackageId || req.body?.wbsPackageId || null,
    authorizedSiteIds: input.authorizedSiteIds || req.user?.authorizedSiteIds || [],
    approvalState: { required: false, approvalId: null, granted: false },
  };
}

export function assertProjectScope(context, projectId) {
  required(context?.tenantId, 'tenantId');
  required(projectId, 'projectId');
  if (context.projectId && context.projectId !== projectId) {
    throw Object.assign(new Error('Project is outside the execution scope'), { statusCode: 403, code: 'PROJECT_SCOPE_MISMATCH' });
  }
  return true;
}

export function can(context, permission) {
  return context.permissions.includes('*') || context.permissions.includes(permission) || context.roles.includes('admin');
}

export function requirePermission(context, permission) {
  if (!can(context, permission)) {
    throw Object.assign(new Error(`${permission} permission is required`), { statusCode: 403, code: 'PERMISSION_DENIED' });
  }
}
