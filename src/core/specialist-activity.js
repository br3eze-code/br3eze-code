const ACTIVITY_STATES = Object.freeze([
  'proposed',
  'assigned',
  'in_progress',
  'submitted',
  'verified',
  'rejected',
  'blocked',
  'paid',
]);

function text(value, fallback = '') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

function safePart(value) {
  return text(value, 'unknown').replace(/[^a-zA-Z0-9_-]+/g, '-');
}

/**
 * Activity identity is deterministic: the same tenant/project/WBS/work item
 * always produces the same chart activity number across channels and restarts.
 */
export function buildActivityIdentity(input = {}) {
  const tenantId = text(input.tenantId);
  const projectId = text(input.projectId);
  const wbsId = text(input.wbsId);
  const workId = text(input.workId);
  const role = text(input.agentRole || input.contractorRole, 'specialist').toLowerCase();
  if (!tenantId || !projectId || (!wbsId && !workId)) {
    throw new Error('tenantId, projectId, and wbsId or workId are required for activity identity');
  }
  const activityId = text(input.activityId, `activity_${safePart(tenantId)}_${safePart(projectId)}_${safePart(wbsId || workId)}`);
  const activityNumber = text(
    input.activityNumber,
    `ACT-${role.toUpperCase()}-${safePart(wbsId || workId)}`
  );
  return Object.freeze({ activityId, activityNumber, chartKey: `${role}:${activityNumber}` });
}

export function normalizeSpecialistActivity(input = {}) {
  const state = text(input.status, 'proposed').toLowerCase();
  if (!ACTIVITY_STATES.includes(state)) throw new Error(`Unsupported specialist activity state: ${state}`);
  const identity = buildActivityIdentity(input);
  return Object.freeze({
    ...identity,
    tenantId: text(input.tenantId),
    projectId: text(input.projectId),
    siteId: input.siteId || null,
    domain: text(input.domain, 'general'),
    wbsId: text(input.wbsId) || null,
    workId: text(input.workId) || null,
    agentRole: text(input.agentRole || input.contractorRole, 'specialist').toLowerCase(),
    ownerUserId: text(input.ownerUserId) || null,
    status: state,
    channel: text(input.channel, 'system').toLowerCase(),
    eventType: text(input.eventType, 'activity.updated'),
    sequence: Number.isInteger(input.sequence) && input.sequence >= 0 ? input.sequence : 0,
    plannedHours: Number.isFinite(Number(input.plannedHours)) ? Number(input.plannedHours) : 0,
    actualHours: Number.isFinite(Number(input.actualHours)) ? Number(input.actualHours) : 0,
    forecastHours: Number.isFinite(Number(input.forecastHours)) ? Number(input.forecastHours) : 0,
    approvedValue: Number.isFinite(Number(input.approvedValue)) ? Number(input.approvedValue) : 0,
    commissionAmount: Number.isFinite(Number(input.commissionAmount)) ? Number(input.commissionAmount) : 0,
    occurredAt: input.occurredAt || new Date().toISOString(),
  });
}

export function summarizeSpecialistActivities(activities = [], scope = {}) {
  const visible = activities.filter((item) =>
    item?.tenantId === scope.tenantId &&
    (!scope.projectId || item.projectId === scope.projectId) &&
    (!scope.siteId || item.siteId === scope.siteId)
  );
  const byRole = Object.create(null);
  const byStatus = Object.create(null);
  for (const item of visible) {
    const role = text(item.agentRole, 'specialist');
    byRole[role] = (byRole[role] || 0) + 1;
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
  }
  return Object.freeze({
    activityCount: visible.length,
    activityNumbers: visible.map((item) => item.activityNumber),
    plannedHours: visible.reduce((sum, item) => sum + Number(item.plannedHours || 0), 0),
    actualHours: visible.reduce((sum, item) => sum + Number(item.actualHours || 0), 0),
    forecastHours: visible.reduce((sum, item) => sum + Number(item.forecastHours || 0), 0),
    commissionAmount: visible.reduce((sum, item) => sum + Number(item.commissionAmount || 0), 0),
    byRole,
    byStatus,
    series: visible.map((item) => ({
      activityNumber: item.activityNumber,
      activityId: item.activityId,
      role: item.agentRole,
      status: item.status,
      plannedHours: Number(item.plannedHours || 0),
      actualHours: Number(item.actualHours || 0),
      forecastHours: Number(item.forecastHours || 0),
      channel: item.channel,
      occurredAt: item.occurredAt,
    })),
  });
}

export { ACTIVITY_STATES };
export default { ACTIVITY_STATES, buildActivityIdentity, normalizeSpecialistActivity, summarizeSpecialistActivities };
