function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function stableSerialize(value) {
  return JSON.stringify(canonicalize(value ?? null));
}

export function scopeFrom(context = {}) {
  const tenantId = context.tenantId || context.scope?.tenantId;
  const userId = context.userId || context.scope?.userId;
  if (!tenantId || !userId) throw new Error('Commerce tools require tenantId and userId');
  return { tenantId, userId, projectId: context.projectId || context.scope?.projectId || null, siteId: context.siteId || context.scope?.siteId || null };
}

export function providerFrom(context = {}, key, label = key) {
  const provider = context[key] || context.services?.[key] || context.providers?.[key];
  if (!provider) throw new Error(`${label} provider is not configured`);
  return provider;
}

export function assertTenant(result, tenantId) {
  const records = Array.isArray(result) ? result : [result];
  for (const record of records) {
    if (record && record.tenantId && record.tenantId !== tenantId) {
      throw new Error('Result is outside the authorized tenant scope');
    }
  }
  return result;
}

export function approvalOrProposal(action, args, context, { risk = 'medium' } = {}) {
  const approval = context.approval || {};
  const tenantId = context.tenantId || context.scope?.tenantId || null;
  const samePayload = approval.args != null && stableSerialize(approval.args) === stableSerialize(args);
  if (
    approval.granted === true
    && approval.action === action
    && approval.tenantId === tenantId
    && samePayload
  ) return null;
  return {
    status: 'approval_required',
    action,
    risk,
    tenantId,
    proposal: args,
    approvalRequired: true,
  };
}

export function providerCall(provider, method, args) {
  if (typeof provider?.[method] !== 'function') throw new Error(`Provider does not support ${method}`);
  return provider[method](args);
}
