import {
  scoreProject,
  rankPortfolio,
  allocatePortfolio,
  validateSelectionModel
} from '../src/core/project-selection-engine.js';

const strongScores = {
  strategic: {
    strategicAlignment: 9, problemImportance: 9, marketOpportunity: 8,
    competitiveAdvantage: 8, revenuePotential: 9, capabilityFit: 8, platformValue: 9
  },
  production: {
    technicalFeasibility: 9, resourceAvailability: 8, operationalComplexity: 8,
    dependencyRisk: 8, timeToMvp: 8, timeToProduction: 8, infrastructureReadiness: 9, qualityFeasibility: 9
  },
  marketing: {
    marketSize: 9, demandEvidence: 9, customerAcquisition: 8, distributionAdvantage: 8,
    brandFit: 9, referralPotential: 8, positioning: 9, marketTiming: 8
  },
  financial: {
    revenuePotential: 9, grossMargin: 8, roi: 9, payback: 8, cashFlow: 8,
    capitalRequirement: 8, downsideProtection: 8
  },
  personnel: {
    skillsAvailable: 8, capacity: 8, hiringDifficulty: 8, keyPersonDependency: 8,
    managementCapacity: 8, trainingRequirement: 8, scalability: 9, retentionRisk: 8
  },
  administration: {
    regulatoryComplexity: 8, licensing: 8, contractComplexity: 8, dataPrivacy: 9,
    accountingComplexity: 8, insuranceLiability: 8, procurementComplexity: 8,
    reporting: 8, governanceReadiness: 9
  }
};

test('selection model weights are internally valid', () => {
  expect(validateSelectionModel().valid).toBe(true);
});

test('scores a strong project without inventing missing evidence', () => {
  const result = scoreProject({
    projectId: 'PRJ-001',
    scores: strongScores,
    evidenceConfidence: 0.95,
    strategicValue: 9,
    urgency: 8,
    requiredBudget: 50000,
    requiredFte: 2
  });

  expect(result.projectId).toBe('PRJ-001');
  expect(result.baseScore).toBeGreaterThan(80);
  expect(result.riskAdjustedScore).toBeLessThanOrEqual(result.baseScore);
  expect(result.decision).toBe('APPROVED');
  expect(result.requiredBudget).toBe(50000);
  expect(result.requiredFte).toBe(2);
});

test('missing criteria are explicit and can gate weak evidence', () => {
  const result = scoreProject({
    projectId: 'PRJ-002',
    scores: { strategic: { strategicAlignment: 9 } },
    evidenceConfidence: 0.1
  });

  expect(result.gateFailures).toContain('INSUFFICIENT_EVIDENCE');
  expect(result.missingCriteria.financial).toContain('roi');
  expect(result.decision).toBe('HOLD');
});

test('critical risk can force a hold despite high scores', () => {
  const result = scoreProject({
    projectId: 'PRJ-003',
    scores: strongScores,
    evidenceConfidence: 1,
    risks: [{ id: 'R1', name: 'Critical dependency', probability: 5, impact: 5, critical: true }]
  });

  expect(result.gateFailures).toContain('CRITICAL_RISK_EXPOSURE');
  expect(result.decision).toBe('HOLD');
});

test('portfolio ranking prefers executable high-score work', () => {
  const ranked = rankPortfolio([
    { projectId: 'LOW', scores: strongScores, evidenceConfidence: 1, strategicValue: 5 },
    { projectId: 'HIGH', scores: strongScores, evidenceConfidence: 1, strategicValue: 9 }
  ]);

  expect(ranked[0].projectId).toBe('HIGH');
  expect(ranked[0].rank).toBe(1);
});

test('allocation respects budget and personnel capacity', () => {
  const projects = [
    { projectId: 'A', scores: strongScores, evidenceConfidence: 1, strategicValue: 9, requiredBudget: 60, requiredFte: 2 },
    { projectId: 'B', scores: strongScores, evidenceConfidence: 1, strategicValue: 8, requiredBudget: 60, requiredFte: 2 }
  ];
  const result = allocatePortfolio(projects, { budget: 100, fte: 3 });

  expect(result[0].allocation.executable).toBe(true);
  expect(result[1].allocation.executable).toBe(false);
  expect(result[1].allocation.fundable).toBe(false);
});
