import { FactValidationError, ProjectFactsAdapter, factsToScoringProject } from '../../src/core/project-selection/project-facts-adapter.js';
import { ProjectSelectionSpecialist } from '../../src/core/project-selection/project-selection-specialist.js';

const evidence = [{ source: 'finance-ledger', collectedAt: '2026-08-17T00:00:00.000Z', strength: 9, maxAgeDays: 30 }];
const facts = {
  projectId: 'PRJ-CANONICAL', tenantId: 'tenant-1', source: 'canonical-records',
  strategicValue: 0.8, urgency: 0.7,
  strategic: { scores: { alignment: 0.9, customerImportance: 0.8 }, evidence },
  production: { scores: { technicalFeasibility: 0.8, resourceAvailability: 0.7 }, evidence },
  marketing: { scores: { marketSize: 0.8, demandEvidence: 0.7 }, evidence },
  financial: { scores: { revenuePotential: 0.8, grossMargin: 0.7, roi: 0.8 }, investment: 100, expectedRevenue: 300, variableCosts: 50, operatingCosts: 50, monthlyNetCashFlow: 20, evidence },
  personnel: { scores: { skillsAvailable: 0.8, capacity: 0.7 }, fteRequired: 2, fteAvailable: 3, criticalSkillAvailable: true, evidence },
  administration: { scores: { regulatoryComplexity: 0.2, privacy: 0.8 }, evidence },
  risks: [{ name: 'delivery', probability: 1, impact: 2 }], resourceRequest: { capital: 100, fte: 2, time: 3 },
};

test('converts bounded canonical facts into normalized scoring input', () => {
  const result = factsToScoringProject(facts, { now: Date.parse('2026-08-17T12:00:00.000Z') });
  expect(result).toMatchObject({ projectId: 'PRJ-CANONICAL', tenantId: 'tenant-1', strategicValue: 8, urgency: 7 });
  expect(result.strategic.criteria.alignment).toBe(9);
  expect(result.financial.investment).toBe(100);
});

test('rejects missing facts, invalid score ranges, and stale or incomplete evidence', () => {
  expect(() => factsToScoringProject({ ...facts, tenantId: undefined }, { now: Date.now() })).toThrow(FactValidationError);
  expect(() => factsToScoringProject({ ...facts, strategic: { scores: { alignment: 2 }, evidence } })).toThrow(FactValidationError);
  expect(() => factsToScoringProject({ ...facts, marketing: { scores: { marketSize: 0.8 }, evidence: [{ ...evidence[0], collectedAt: '2020-01-01T00:00:00.000Z', maxAgeDays: 1 }] } }, { now: Date.parse('2026-08-17T00:00:00.000Z') })).toThrow(FactValidationError);
});

test('loads facts from tenant-scoped canonical stores and evaluates through the specialist', async () => {
  const calls = [];
  const stores = { projectStore: { get: async (...args) => { calls.push(['project', ...args]); return facts; } }, financeStore: { get: async () => facts.financial }, capacityStore: { get: async () => facts.personnel }, riskStore: { get: async () => facts.risks } };
  const adapter = new ProjectFactsAdapter({ ...stores, clock: () => Date.parse('2026-08-17T12:00:00.000Z') });
  const specialist = new ProjectSelectionSpecialist({ factsAdapter: adapter });
  const result = await specialist.evaluateFromCanonicalFacts('PRJ-CANONICAL', { tenantId: 'tenant-1', taskId: 'TASK-FACTS' });
  expect(calls).toEqual([['project', 'PRJ-CANONICAL', 'tenant-1']]);
  expect(result).toMatchObject({ tenantId: 'tenant-1', taskId: 'TASK-FACTS', evaluation: { projectId: 'PRJ-CANONICAL' } });
});

test('rejects unscoped adapter access and missing projects', async () => {
  const adapter = new ProjectFactsAdapter({ projectStore: { get: async () => null }, financeStore: { get: async () => null }, capacityStore: { get: async () => null }, riskStore: { get: async () => [] } });
  await expect(adapter.getProjectFacts('PRJ-1')).rejects.toMatchObject({ code: 'TENANT_SCOPE_REQUIRED' });
  await expect(adapter.getProjectFacts('PRJ-1', 'tenant-1')).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
});

test('rejects future evidence dates and malformed numeric facts', () => {
  expect(() => factsToScoringProject({ ...facts, strategic: { ...facts.strategic, evidence: [{ ...evidence[0], collectedAt: '2027-01-01T00:00:00.000Z' }] } }, { now: Date.parse('2026-08-17T12:00:00.000Z') })).toThrow(FactValidationError);
  expect(() => factsToScoringProject({ ...facts, financial: { ...facts.financial, investment: -1 } }, { now: Date.parse('2026-08-17T12:00:00.000Z') })).toThrow(FactValidationError);
});

test('fails closed when a canonical store is missing or returns another tenant', async () => {
  const baseStores = { projectStore: { get: async () => facts }, financeStore: { get: async () => facts.financial }, capacityStore: { get: async () => facts.personnel }, riskStore: { get: async () => facts.risks } };
  await expect(new ProjectFactsAdapter({ ...baseStores, financeStore: null }).getProjectFacts('PRJ-CANONICAL', 'tenant-1')).rejects.toMatchObject({ code: 'DATA_STORE_NOT_CONFIGURED' });
  await expect(new ProjectFactsAdapter({ ...baseStores, financeStore: { get: async () => ({ ...facts.financial, tenantId: 'tenant-2' }) } }).getProjectFacts('PRJ-CANONICAL', 'tenant-1')).rejects.toMatchObject({ code: 'TENANT_SCOPE_MISMATCH' });
});
