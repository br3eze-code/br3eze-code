import { ProjectSelectionEngine } from '../../src/core/project-selection/selection-engine.js';
import { ProjectSelectionSpecialist } from '../../src/core/project-selection/project-selection-specialist.js';

const strongProject = overrides => ({
  projectId: 'PRJ-001',
  strategic: { criteria: { alignment: 9, customerImportance: 9, marketOpportunity: 8, competitiveAdvantage: 8, revenuePotential: 8, capabilityFit: 8, platformValue: 8 }, evidence: [{ strength: 9 }] },
  production: { criteria: { technicalFeasibility: 8, resourceAvailability: 8, operationalComplexity: 2, supplyDependency: 8, timeToMvp: 8, timeToProduction: 8, infrastructureReadiness: 8, qualityFeasibility: 8 }, evidence: [{ strength: 8 }] },
  marketing: { criteria: { marketSize: 8, demandEvidence: 9, acquisitionFeasibility: 8, distributionAdvantage: 8, brandFit: 8, referralPotential: 7, positioning: 8, timing: 8 }, evidence: [{ strength: 9 }] },
  financial: { criteria: { revenuePotential: 8, grossMargin: 8, roi: 8, payback: 8, cashFlow: 8, capitalRequirement: 7, downside: 8 }, investment: 50000, expectedRevenue: 180000, variableCosts: 60000, operatingCosts: 20000, monthlyNetCashFlow: 10000, evidence: [{ strength: 8 }] },
  personnel: { criteria: { skillsAvailable: 8, capacity: 8, hiringDifficulty: 8, keyPersonDependency: 8, managementCapacity: 8, training: 8, scalability: 8, retention: 8 }, fteRequired: 2, fteAvailable: 3, criticalSkillAvailable: true, evidence: [{ strength: 8 }] },
  administration: { criteria: { regulatoryComplexity: 2, licensing: 8, contracts: 8, privacy: 8, accounting: 8, liability: 8, procurement: 8, reporting: 8, governance: 8 }, evidence: [{ strength: 8 }] },
  risks: [{ name: 'supplier', probability: 1, impact: 2 }],
  strategicValue: 9,
  urgency: 8,
  resourceRequest: { capital: 50000, fte: 2, time: 4 },
  ...overrides,
});

test('scores independent dimensions and applies risk adjustment without fake precision', () => {
  const result = new ProjectSelectionEngine().evaluate(strongProject());
  expect(result.dimensions).toHaveProperty('strategic');
  expect(result.dimensions.financial.metrics).toMatchObject({ contributionMargin: 120000, netBenefit: 100000 });
  expect(result.risk.totalExposure).toBe(2);
  expect(result.risk.riskAdjustment).toBeGreaterThan(0);
  expect(result.decision.baseScore).toBeGreaterThan(0);
  expect(result.decision.riskAdjustedScore).toBeLessThanOrEqual(result.decision.baseScore);
});

test('enforces hard gates before weighted decision bands', () => {
  const engine = new ProjectSelectionEngine();
  expect(engine.evaluate(strongProject({ gates: { regulatoryBlocker: true } })).decision.status).toBe('REJECT');
  expect(engine.evaluate(strongProject({ gates: { fundingAvailable: false } })).decision.status).toBe('HOLD');
  expect(engine.evaluate(strongProject({ personnel: { ...strongProject().personnel, criticalSkillAvailable: false } })).decision.status).toBe('REVIEW');
  expect(engine.evaluate(strongProject({ financial: { ...strongProject().financial, expectedRevenue: 1000, variableCosts: 2000 } })).decision.status).toBe('REVIEW');
});

test('calculates capacity gap and uses strategic value and urgency as portfolio signals', () => {
  const result = new ProjectSelectionEngine().evaluate(strongProject({ personnel: { ...strongProject().personnel, fteRequired: 5, fteAvailable: 3 } }));
  expect(result.dimensions.personnel.capacityGap).toBe(2);
  expect(result.decision.strategicValue).toBe(9);
  expect(result.decision.urgency).toBe(8);
});

test('allocates scarce resources by risk-adjusted score and defers constrained projects', () => {
  const engine = new ProjectSelectionEngine();
  const first = engine.evaluate(strongProject({ projectId: 'PRJ-1', resourceRequest: { capital: 60, fte: 2, time: 2 } }));
  const second = engine.evaluate(strongProject({ projectId: 'PRJ-2', resourceRequest: { capital: 60, fte: 2, time: 2 }, risks: [{ probability: 4, impact: 5 }] }));
  const allocation = engine.allocate([second, first], { capital: 60, fte: 2, time: 2 });
  expect(allocation.allocations).toEqual(expect.arrayContaining([{ projectId: 'PRJ-1', status: 'ALLOCATED', request: { capital: 60, fte: 2, time: 2 } }]));
  expect(allocation.allocations.find(item => item.projectId === 'PRJ-2').status).toBe('DEFERRED');
});

test('routes conditional project decisions to Project Manager with evidence', async () => {
  const handoffs = [];
  const specialist = new ProjectSelectionSpecialist({ handoff: async handoff => handoffs.push(handoff) });
  const result = await specialist.recommend(strongProject({ gates: { fundingAvailable: false } }), { tenantId: 'tenant-1', taskId: 'TASK-1' });
  expect(result.evaluation.decision.status).toBe('HOLD');
  expect(handoffs[0]).toMatchObject({ to: 'project-manager', action: 'project-selection.review', tenantId: 'tenant-1', taskId: 'TASK-1' });
  expect(handoffs[0].evidence.projectId).toBe('PRJ-001');
});
