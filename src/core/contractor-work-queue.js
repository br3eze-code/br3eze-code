import { randomUUID } from 'node:crypto';
import { normalizeSpecialistActivity } from './specialist-activity.js';

export const SPECIALIST_CONTRACTORS = Object.freeze([
  'planner', 'engineer', 'accountant', 'secretary', 'procurement',
  'expeditor', 'designer', 'draftsman', 'qa',
]);

export const WORK_STATES = Object.freeze([
  'proposed', 'assigned', 'in_progress', 'submitted', 'verified', 'rejected', 'blocked', 'paid',
]);
export const COMMISSION_STATES = Object.freeze([
  'unearned', 'pending_verification', 'approved', 'payable', 'paid', 'disputed',
]);

const TIER_RANK = Object.freeze({ guest: 0, standard: 1, partner: 2, pro: 3, enterprise: 4, admin: 5, owner: 6 });

function text(value, fallback = '') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

export function normalizeTier(value) {
  const tier = text(value, 'standard').toLowerCase();
  return Object.hasOwn(TIER_RANK, tier) ? tier : 'standard';
}

export function normalizeContractorWork(input = {}, scope = {}) {
  const role = text(input.agentRole || input.contractorRole).toLowerCase();
  if (!SPECIALIST_CONTRACTORS.includes(role)) throw new Error(`Unsupported contractor role: ${role || 'missing'}`);
  if (!scope.tenantId || !scope.userId || !scope.projectId) throw new Error('tenantId, userId, and projectId are required for contractor work');
  const state = text(input.status, 'proposed').toLowerCase();
  if (!WORK_STATES.includes(state)) throw new Error(`Unsupported contractor work state: ${state}`);
  const workId = text(input.workId, `work_${randomUUID()}`);
  const ownerUserId = text(input.ownerUserId, scope.userId);
  const activity = normalizeSpecialistActivity({
    ...input, workId, tenantId: scope.tenantId, projectId: scope.projectId,
    siteId: scope.siteId, domain: scope.domain, agentRole: role, ownerUserId, status: state,
  });
  return Object.freeze({
    workId,
    wbsId: text(input.wbsId),
    activityId: activity.activityId,
    activityNumber: activity.activityNumber,
    chartKey: activity.chartKey,
    projectId: scope.projectId,
    tenantId: scope.tenantId,
    siteId: scope.siteId || null,
    domain: scope.domain || 'general',
    contractorRole: role,
    ownerUserId,
    title: text(input.title, 'Untitled contractor work'),
    objective: text(input.objective),
    status: state,
    evidenceRefs: Array.isArray(input.evidenceRefs) ? [...input.evidenceRefs] : [],
    approvedValue: Number.isFinite(Number(input.approvedValue)) ? Number(input.approvedValue) : 0,
    commissionRate: Math.max(0, Math.min(1, Number(input.commissionRate) || 0)),
    commissionState: text(input.commissionState, 'unearned').toLowerCase(),
    tierVisibility: normalizeTier(input.tierVisibility || 'standard'),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export function calculateCommission({ approvedValue = 0, commissionRate = 0, status = 'submitted', evidenceRefs = [] } = {}) {
  const value = Math.max(0, Number(approvedValue) || 0);
  const rate = Math.max(0, Math.min(1, Number(commissionRate) || 0));
  const verified = status === 'verified' || status === 'paid';
  const amount = Math.round(value * rate * 100) / 100;
  return Object.freeze({ amount, rate, state: verified && evidenceRefs.length ? 'payable' : 'pending_verification' });
}

export function canViewContractorWork({ viewerTier = 'standard', viewerRole = 'user', work, viewerUserId } = {}) {
  if (!work) return false;
  if (['owner', 'admin'].includes(String(viewerRole).toLowerCase())) return true;
  const viewerRank = TIER_RANK[normalizeTier(viewerTier)];
  const requiredRank = TIER_RANK[normalizeTier(work.tierVisibility)];
  return work.ownerUserId === viewerUserId || viewerRank >= requiredRank;
}

export function summarizeContractorWork(items = [], { viewerTier = 'standard', viewerRole = 'user', viewerUserId } = {}) {
  const visible = items.filter(item => canViewContractorWork({ viewerTier, viewerRole, work: item, viewerUserId }));
  const commission = visible.reduce((sum, item) => sum + calculateCommission(item).amount, 0);
  return Object.freeze({
    visibleCount: visible.length,
    activeCount: visible.filter(item => !['paid', 'rejected'].includes(item.status)).length,
    verifiedCount: visible.filter(item => item.status === 'verified' || item.status === 'paid').length,
    commissionPending: Math.round(commission * 100) / 100,
    activityNumbers: visible.map(item => item.activityNumber),
    byRole: Object.fromEntries(SPECIALIST_CONTRACTORS.map(role => [role, visible.filter(item => item.contractorRole === role).length])),
  });
}

export default { SPECIALIST_CONTRACTORS, WORK_STATES, COMMISSION_STATES, normalizeContractorWork, calculateCommission, canViewContractorWork, summarizeContractorWork };
