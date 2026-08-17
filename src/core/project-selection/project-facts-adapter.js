const DIMENSIONS = Object.freeze(['strategic', 'production', 'marketing', 'financial', 'personnel', 'administration']);
const clamp01 = value => Math.max(0, Math.min(1, Number(value)));
const to10 = value => Number((clamp01(value) * 10).toFixed(2));

export class FactValidationError extends Error {
  constructor(issues) {
    super('Project facts failed validation');
    this.name = 'FactValidationError';
    this.code = 'FACT_VALIDATION_ERROR';
    this.issues = issues;
  }
}

const issue = (issues, path, code, message) => issues.push({ path, code, message });

const requireNumber = (issues, path, value, { min = 0, max = 1 } = {}) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    issue(issues, path, 'INVALID_NUMBER', `Expected number between ${min} and ${max}`);
  }
};

const requireOptionalNonNegativeNumber = (issues, path, value) => {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
    issue(issues, path, 'INVALID_NON_NEGATIVE_NUMBER', 'Expected a finite non-negative number');
  }
};

const validateEvidence = (issues, dimension, evidence = [], now) => {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    issue(issues, `${dimension}.evidence`, 'EVIDENCE_REQUIRED', 'At least one evidence item is required');
    return;
  }

  evidence.forEach((item, index) => {
    const path = `${dimension}.evidence[${index}]`;
    if (!item || typeof item !== 'object') {
      issue(issues, path, 'INVALID_EVIDENCE', 'Evidence must be an object');
      return;
    }
    if (!item.source || typeof item.source !== 'string') issue(issues, `${path}.source`, 'SOURCE_REQUIRED', 'Evidence source is required');
    const date = Date.parse(item.collectedAt || '');
    if (!Number.isFinite(date)) issue(issues, `${path}.collectedAt`, 'DATE_REQUIRED', 'Evidence collection date is required');
    if (Number.isFinite(date) && date > now) issue(issues, `${path}.collectedAt`, 'FUTURE_EVIDENCE_DATE', 'Evidence collection date cannot be in the future');
    requireNumber(issues, `${path}.strength`, item.strength, { min: 0, max: 10 });
    if (item.maxAgeDays !== undefined) {
      if (typeof item.maxAgeDays !== 'number' || !Number.isFinite(item.maxAgeDays) || item.maxAgeDays < 0) {
        issue(issues, `${path}.maxAgeDays`, 'INVALID_FRESHNESS_WINDOW', 'maxAgeDays must be a finite non-negative number');
      } else if (Number.isFinite(date) && now - date > item.maxAgeDays * 86400000) {
        issue(issues, path, 'STALE_EVIDENCE', 'Evidence is older than its allowed freshness window');
      }
    }
  });
};

export function factsToScoringProject(facts, { now = Date.now() } = {}) {
  const issues = [];
  if (!facts?.projectId) issue(issues, 'projectId', 'REQUIRED', 'projectId is required');
  if (!facts?.tenantId) issue(issues, 'tenantId', 'REQUIRED', 'tenantId is required');

  for (const dimension of DIMENSIONS) {
    const section = facts?.[dimension] || {};
    validateEvidence(issues, dimension, section.evidence, now);
    for (const [key, value] of Object.entries(section.scores || {})) requireNumber(issues, `${dimension}.scores.${key}`, value);
  }

  for (const path of ['financial.investment', 'financial.expectedRevenue', 'financial.variableCosts', 'financial.operatingCosts', 'financial.monthlyNetCashFlow', 'personnel.fteRequired', 'personnel.fteAvailable']) {
    const [dimension, key] = path.split('.');
    requireOptionalNonNegativeNumber(issues, path, facts?.[dimension]?.[key]);
  }
  for (const path of ['strategicValue', 'urgency']) {
    if (facts?.[path] !== undefined) requireNumber(issues, path, facts[path]);
  }
  if (facts?.resourceRequest !== undefined && (typeof facts.resourceRequest !== 'object' || Array.isArray(facts.resourceRequest))) issue(issues, 'resourceRequest', 'INVALID_RESOURCE_REQUEST', 'resourceRequest must be an object');
  if (facts?.assumptions !== undefined && !Array.isArray(facts.assumptions)) issue(issues, 'assumptions', 'INVALID_ASSUMPTIONS', 'assumptions must be an array');

  if (issues.length) throw new FactValidationError(issues);
  const scores = section => Object.fromEntries(Object.entries(section?.scores || {}).map(([key, value]) => [key, to10(value)]));
  return {
    projectId: facts.projectId,
    tenantId: facts.tenantId,
    strategic: { criteria: scores(facts.strategic), evidence: facts.strategic.evidence },
    production: { criteria: scores(facts.production), evidence: facts.production.evidence },
    marketing: { criteria: scores(facts.marketing), evidence: facts.marketing.evidence },
    financial: { criteria: scores(facts.financial), evidence: facts.financial.evidence, investment: facts.financial.investment, expectedRevenue: facts.financial.expectedRevenue, variableCosts: facts.financial.variableCosts, operatingCosts: facts.financial.operatingCosts, monthlyNetCashFlow: facts.financial.monthlyNetCashFlow },
    personnel: { criteria: scores(facts.personnel), evidence: facts.personnel.evidence, fteRequired: facts.personnel.fteRequired, fteAvailable: facts.personnel.fteAvailable, criticalSkillAvailable: facts.personnel.criticalSkillAvailable },
    administration: { criteria: scores(facts.administration), evidence: facts.administration.evidence },
    risks: facts.risks || [],
    risk: facts.risk || {},
    gates: facts.gates || {},
    strategicValue: to10(facts.strategicValue ?? 0),
    urgency: to10(facts.urgency ?? 0),
    assumptions: facts.assumptions || [],
    resourceRequest: facts.resourceRequest || {},
    factMetadata: { source: facts.source || 'canonical-adapter', evaluatedAt: new Date(now).toISOString() },
  };
}

const assertStore = (store, name) => {
  if (!store || typeof store.get !== 'function') throw Object.assign(new Error(`${name} store is not configured`), { code: 'DATA_STORE_NOT_CONFIGURED', store: name });
};

const assertTenantRecord = (record, storeName, tenantId) => {
  if (record && record.tenantId !== undefined && record.tenantId !== tenantId) {
    throw Object.assign(new Error(`${storeName} record is outside the requested tenant`), { code: 'TENANT_SCOPE_MISMATCH', store: storeName, tenantId });
  }
};

export class ProjectFactsAdapter {
  constructor({ projectStore, financeStore, capacityStore, riskStore, clock = () => Date.now() }) {
    this.projectStore = projectStore;
    this.financeStore = financeStore;
    this.capacityStore = capacityStore;
    this.riskStore = riskStore;
    this.clock = clock;
  }

  async getProjectFacts(projectId, tenantId) {
    if (!tenantId) throw Object.assign(new Error('tenantId is required'), { code: 'TENANT_SCOPE_REQUIRED' });
    if (!projectId) throw Object.assign(new Error('projectId is required'), { code: 'PROJECT_ID_REQUIRED' });
    assertStore(this.projectStore, 'project');
    assertStore(this.financeStore, 'finance');
    assertStore(this.capacityStore, 'capacity');
    assertStore(this.riskStore, 'risk');

    const [project, finance, capacity, risks] = await Promise.all([
      this.projectStore.get(projectId, tenantId),
      this.financeStore.get(projectId, tenantId),
      this.capacityStore.get(projectId, tenantId),
      this.riskStore.get(projectId, tenantId),
    ]);
    if (!project) throw Object.assign(new Error('Project not found'), { code: 'PROJECT_NOT_FOUND' });
    assertTenantRecord(project, 'project', tenantId);
    assertTenantRecord(finance, 'finance', tenantId);
    assertTenantRecord(capacity, 'capacity', tenantId);
    if (risks && !Array.isArray(risks) && typeof risks === 'object') assertTenantRecord(risks, 'risk', tenantId);
    const now = this.clock();
    return factsToScoringProject({ ...project, financial: { ...project.financial, ...finance }, personnel: { ...project.personnel, ...capacity }, risks: Array.isArray(risks) ? risks : risks?.items || [], tenantId, projectId }, { now });
  }
}
