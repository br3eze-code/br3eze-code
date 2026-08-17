const WEIGHTS = Object.freeze({ strategic: 0.20, production: 0.20, marketing: 0.15, financial: 0.25, personnel: 0.10, administration: 0.10 });
const BANDS = Object.freeze([{ min: 85, status: 'PRIORITY' }, { min: 70, status: 'APPROVED' }, { min: 55, status: 'CONDITIONAL' }, { min: 40, status: 'HOLD' }, { min: 0, status: 'REJECT' }]);
const DIMENSION_KEYS = Object.freeze(['strategic', 'production', 'marketing', 'financial', 'personnel', 'administration']);
const clamp = value => Math.max(0, Math.min(10, Number(value) || 0));
const score = (criteria = {}, weights = {}, reverse = []) => { const entries = Object.entries(weights); const total = entries.reduce((sum, [key, weight]) => sum + (reverse.includes(key) ? 10 - clamp(criteria[key]) : clamp(criteria[key])) * weight, 0); return Number((Math.max(0, total) * 10).toFixed(2)); };
const evidenceQuality = (evidence = []) => evidence.length ? Number((evidence.reduce((sum, item) => sum + clamp(item.strength ?? item.quality ?? 0), 0) / evidence.length).toFixed(2)) : 0;
const financialMetrics = financial => { const investment = Number(financial.investment || 0); const expectedRevenue = Number(financial.expectedRevenue || 0); const variableCosts = Number(financial.variableCosts || 0); const operatingCosts = Number(financial.operatingCosts || 0); const netBenefit = expectedRevenue - variableCosts - operatingCosts; const monthlyNetCashFlow = Number(financial.monthlyNetCashFlow || 0); return { investment, expectedRevenue, contributionMargin: expectedRevenue - variableCosts, roi: investment > 0 ? Number(((netBenefit / investment) * 100).toFixed(2)) : 0, paybackMonths: monthlyNetCashFlow > 0 ? Number((investment / monthlyNetCashFlow).toFixed(2)) : null, netBenefit }; };

export class ProjectSelectionEngine {
  evaluate(project) {
    if (!project?.projectId) throw new TypeError('projectId is required');
    const financial = { ...project.financial, metrics: financialMetrics(project.financial || {}) };
    const dimensions = {
      strategic: { score: score(project.strategic?.criteria, { alignment: 0.20, customerImportance: 0.20, marketOpportunity: 0.15, competitiveAdvantage: 0.15, revenuePotential: 0.15, capabilityFit: 0.10, platformValue: 0.05 }), evidenceQuality: evidenceQuality(project.strategic?.evidence) },
      production: { score: score(project.production?.criteria, { technicalFeasibility: 0.20, resourceAvailability: 0.15, operationalComplexity: 0.15, supplyDependency: 0.10, timeToMvp: 0.10, timeToProduction: 0.10, infrastructureReadiness: 0.10, qualityFeasibility: 0.10 }, ['operationalComplexity']), evidenceQuality: evidenceQuality(project.production?.evidence) },
      marketing: { score: score(project.marketing?.criteria, { marketSize: 0.15, demandEvidence: 0.20, acquisitionFeasibility: 0.15, distributionAdvantage: 0.15, brandFit: 0.10, referralPotential: 0.10, positioning: 0.10, timing: 0.05 }), evidenceQuality: evidenceQuality(project.marketing?.evidence) },
      financial: { score: score(project.financial?.criteria, { revenuePotential: 0.15, grossMargin: 0.15, roi: 0.20, payback: 0.15, cashFlow: 0.15, capitalRequirement: 0.10, downside: 0.10 }), evidenceQuality: evidenceQuality(project.financial?.evidence), metrics: financial.metrics },
      personnel: { score: score(project.personnel?.criteria, { skillsAvailable: 0.20, capacity: 0.15, hiringDifficulty: 0.15, keyPersonDependency: 0.15, managementCapacity: 0.10, training: 0.10, scalability: 0.10, retention: 0.05 }), evidenceQuality: evidenceQuality(project.personnel?.evidence), fteRequired: project.personnel?.fteRequired || 0, fteAvailable: project.personnel?.fteAvailable || 0, capacityGap: Math.max(0, (project.personnel?.fteRequired || 0) - (project.personnel?.fteAvailable || 0)) },
      administration: { score: score(project.administration?.criteria, { regulatoryComplexity: 0.15, licensing: 0.10, contracts: 0.10, privacy: 0.15, accounting: 0.10, liability: 0.10, procurement: 0.10, reporting: 0.10, governance: 0.10 }, ['regulatoryComplexity']), evidenceQuality: evidenceQuality(project.administration?.evidence) },
    };
    const risks = (project.risks || []).map(risk => ({ ...risk, exposure: Number(risk.probability || 0) * Number(risk.impact || 0) }));
    const totalExposure = risks.reduce((sum, risk) => sum + risk.exposure, 0);
    const maximumExposure = Math.max(1, (project.risk?.maximumExposure || risks.length * 25));
    const riskAdjustment = Number(Math.max(0, 1 - (totalExposure / maximumExposure)).toFixed(4));
    const gates = this.#gates(project, financial.metrics);
    const baseScore = Number(DIMENSION_KEYS.reduce((sum, key) => sum + dimensions[key].score * WEIGHTS[key], 0).toFixed(2));
    const riskAdjustedScore = Number((baseScore * riskAdjustment).toFixed(2));
    const status = gates.some(gate => gate.result !== 'PASS') ? gates.find(gate => gate.result !== 'PASS').decision : BANDS.find(band => riskAdjustedScore >= band.min).status;
    return Object.freeze({ projectId: project.projectId, dimensions: Object.freeze(dimensions), risks: Object.freeze(risks), risk: Object.freeze({ totalExposure, riskAdjustment }), gates: Object.freeze(gates), decision: Object.freeze({ baseScore, riskAdjustedScore, status, strategicValue: clamp(project.strategicValue), urgency: clamp(project.urgency) }), assumptions: Object.freeze([...(project.assumptions || [])]), evidenceQuality: Number((DIMENSION_KEYS.reduce((sum, key) => sum + dimensions[key].evidenceQuality, 0) / DIMENSION_KEYS.length).toFixed(2)), resourceRequest: Object.freeze({ ...(project.resourceRequest || {}) }) });
  }

  allocate(evaluations, resources) {
    const available = { capital: Number(resources?.capital || 0), fte: Number(resources?.fte || 0), time: Number(resources?.time || 0) };
    const ranked = [...evaluations].sort((a, b) => b.decision.riskAdjustedScore - a.decision.riskAdjustedScore);
    const allocations = []; const remaining = { ...available };
    for (const evaluation of ranked) {
      if (['REJECT', 'HOLD', 'REVIEW'].includes(evaluation.decision.status)) { allocations.push({ projectId: evaluation.projectId, status: 'DEFERRED', reason: 'DECISION_GATE' }); continue; }
      const request = evaluation.resourceRequest || {}; const affordable = (request.capital || 0) <= remaining.capital && (request.fte || 0) <= remaining.fte && (request.time || 0) <= remaining.time;
      if (affordable) { allocations.push({ projectId: evaluation.projectId, status: 'ALLOCATED', request }); remaining.capital -= request.capital || 0; remaining.fte -= request.fte || 0; remaining.time -= request.time || 0; } else allocations.push({ projectId: evaluation.projectId, status: 'DEFERRED', reason: 'SCARCE_RESOURCE_CONSTRAINT' });
    }
    return { allocations, remaining };
  }

  #gates(project, metrics) { return [
    { id: 'REGULATORY', result: project.gates?.regulatoryBlocker ? 'BLOCKED' : 'PASS', decision: 'REJECT' },
    { id: 'FUNDING', result: project.gates?.fundingAvailable === false ? 'BLOCKED' : 'PASS', decision: 'HOLD' },
    { id: 'CRITICAL_SKILL', result: project.personnel?.criticalSkillAvailable === false ? 'BLOCKED' : 'PASS', decision: 'REVIEW' },
    { id: 'UNIT_ECONOMICS', result: metrics.netBenefit < 0 ? 'BLOCKED' : 'PASS', decision: 'REVIEW' },
    { id: 'STRATEGIC_ALIGNMENT', result: clamp(project.strategic?.criteria?.alignment) < 4 ? 'BLOCKED' : 'PASS', decision: 'REJECT' },
  ]; }
}

export const PROJECT_SELECTION_WEIGHTS = WEIGHTS;
