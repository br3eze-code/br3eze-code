/**
 * AgentOS Phase 4 — Project Selection Engine
 *
 * Portfolio decision support for strategic, production, marketing, financial,
 * personnel and administration considerations. Scores are deliberately
 * separate from execution: this module selects and prioritises work; it does
 * not execute projects and it cannot change a project's acceptance criteria.
 */
import model from '../../config/project-selection-model.json' with { type: 'json' };

const DIMENSIONS = Object.freeze(Object.keys(model.dimensions));
const clamp = (value, min = 0, max = 10) => Math.min(max, Math.max(min, Number(value)));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function weightedCriteria(criteria, scores) {
  const entries = Object.entries(criteria);
  if (!entries.length) return { score: 0, missing: [], count: 0 };
  let total = 0;
  const missing = [];
  for (const [key, weight] of entries) {
    const raw = scores?.[key];
    if (!Number.isFinite(Number(raw))) missing.push(key);
    total += clamp(raw) * Number(weight);
  }
  return { score: Number(total.toFixed(4)), missing, count: entries.length };
}

function scoreDimensions(input) {
  const result = {};
  for (const dimension of DIMENSIONS) {
    const definition = model.dimensions[dimension];
    result[dimension] = weightedCriteria(definition.criteria, input?.scores?.[dimension]);
  }
  return result;
}

function riskModel(risks = []) {
  if (!Array.isArray(risks)) throw new TypeError('risks must be an array');
  const normalized = risks.map((risk, index) => {
    const probability = Math.min(model.risk.probabilityScale, Math.max(1, finite(risk?.probability, 1)));
    const impact = Math.min(model.risk.impactScale, Math.max(1, finite(risk?.impact, 1)));
    return {
      id: String(risk?.id || `RISK-${String(index + 1).padStart(3, '0')}`),
      name: String(risk?.name || 'Unnamed risk'),
      probability,
      impact,
      exposure: probability * impact,
      critical: Boolean(risk?.critical)
    };
  });
  const totalExposure = normalized.reduce((sum, risk) => sum + risk.exposure, 0);
  const maximumCriticalExposure = normalized.filter((risk) => risk.critical).reduce((max, risk) => Math.max(max, risk.exposure), 0);
  const maxExposure = Math.max(model.risk.maxExposure, totalExposure);
  const rawAdjustment = 1 - (totalExposure / maxExposure);
  const adjustment = Math.max(model.risk.adjustmentFloor, Math.min(1, rawAdjustment));
  return { risks: normalized, totalExposure, maximumCriticalExposure, adjustment: Number(adjustment.toFixed(4)) };
}

function evidenceConfidence(input) {
  const value = input?.evidenceConfidence;
  const confidence = Number.isFinite(Number(value))
    ? Math.min(1, Math.max(0, Number(value)))
    : model.evidence.defaultConfidence;
  return Number(confidence.toFixed(4));
}

function evaluateGates(dimensions, risk, confidence) {
  const failures = [];
  if (dimensions.strategic.score < model.gates.minimumStrategic) failures.push('STRATEGIC_MINIMUM');
  if (dimensions.financial.score < model.gates.minimumFinancial) failures.push('FINANCIAL_MINIMUM');
  if (dimensions.production.score < model.gates.minimumProduction) failures.push('PRODUCTION_MINIMUM');
  if (risk.maximumCriticalExposure > model.gates.maximumCriticalRiskExposure) failures.push('CRITICAL_RISK_EXPOSURE');
  if (confidence < model.gates.minimumEvidenceConfidence) failures.push('INSUFFICIENT_EVIDENCE');
  return failures;
}

function decisionBand(score) {
  if (score >= model.decisionBands.priority) return 'PRIORITY';
  if (score >= model.decisionBands.approved) return 'APPROVED';
  if (score >= model.decisionBands.conditional) return 'CONDITIONAL';
  if (score >= model.decisionBands.hold) return 'HOLD';
  return 'REJECT';
}

function urgencyBand(value) {
  const urgency = clamp(value);
  if (urgency >= 8) return 'HIGH';
  if (urgency >= 5) return 'MEDIUM';
  return 'LOW';
}

/**
 * Score one project. All supplied criterion values use a 0–10 scale.
 * Missing criteria are reported and treated as zero rather than guessed.
 */
export function scoreProject(input = {}) {
  const projectId = String(input.projectId || '').trim();
  if (!projectId) throw new Error('projectId is required');

  const dimensions = scoreDimensions(input);
  const risk = riskModel(input.risks);
  const confidence = evidenceConfidence(input);
  const gates = evaluateGates(dimensions, risk, confidence);

  const baseScore = DIMENSIONS.reduce(
    (sum, dimension) => sum + dimensions[dimension].score * model.dimensions[dimension].weight,
    0
  );

  // Evidence uncertainty is a bounded penalty. High-confidence evidence has no penalty.
  const evidenceFactor = 1 - ((1 - confidence) * model.evidence.confidencePenalty);
  const riskAdjustedScore = baseScore * risk.adjustment * evidenceFactor;
  const finalScore = Number(riskAdjustedScore.toFixed(2));
  const status = gates.length ? 'HOLD' : decisionBand(finalScore);

  const missingCriteria = Object.fromEntries(
    DIMENSIONS
      .filter((dimension) => dimensions[dimension].missing.length)
      .map((dimension) => [dimension, dimensions[dimension].missing])
  );

  return {
    projectId,
    dimensions: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, Number(dimensions[dimension].score.toFixed(2))])),
    dimensionDetails: dimensions,
    risk,
    evidenceConfidence: confidence,
    baseScore: Number(baseScore.toFixed(2)),
    riskAdjustedScore: finalScore,
    decision: status,
    gateFailures: gates,
    missingCriteria,
    urgency: urgencyBand(input.urgency),
    strategicValue: clamp(input.strategicValue),
    constraints: Array.isArray(input.constraints) ? [...input.constraints] : []
  };
}

/**
 * Rank a portfolio. Selection score is not enough: constrained projects are
 * surfaced explicitly so scarce people/capital/time are not silently ignored.
 */
export function rankPortfolio(projects = []) {
  if (!Array.isArray(projects)) throw new TypeError('projects must be an array');
  const scored = projects.map(scoreProject);
  return scored.sort((a, b) => {
    if (a.decision === 'HOLD' && b.decision !== 'HOLD') return 1;
    if (a.decision !== 'HOLD' && b.decision === 'HOLD') return -1;
    return b.riskAdjustedScore - a.riskAdjustedScore || b.strategicValue - a.strategicValue;
  }).map((project, index) => ({ ...project, rank: index + 1 }));
}

/**
 * Portfolio allocation view. Budget and FTE are hard resource constraints;
 * projects are considered in rank order and marked as fundable/staffable.
 */
export function allocatePortfolio(projects, resources = {}) {
  const ranked = rankPortfolio(projects);
  let remainingBudget = Math.max(0, finite(resources.budget));
  let remainingFte = Math.max(0, finite(resources.fte));

  return ranked.map((project) => {
    const requiredBudget = Math.max(0, finite(project.requiredBudget));
    const requiredFte = Math.max(0, finite(project.requiredFte));
    const fundable = requiredBudget <= remainingBudget;
    const staffable = requiredFte <= remainingFte;
    const executable = project.decision !== 'REJECT' && project.decision !== 'HOLD' && fundable && staffable;
    if (executable) {
      remainingBudget -= requiredBudget;
      remainingFte -= requiredFte;
    }
    return {
      ...project,
      allocation: {
        requiredBudget,
        requiredFte,
        fundable,
        staffable,
        executable,
        remainingBudget: Number(remainingBudget.toFixed(2)),
        remainingFte: Number(remainingFte.toFixed(2))
      }
    };
  });
}

export function validateSelectionModel() {
  const errors = [];
  const weights = DIMENSIONS.reduce((sum, dimension) => sum + model.dimensions[dimension].weight, 0);
  if (Math.abs(weights - 1) > 0.000001) errors.push(`dimension weights must total 1, got ${weights}`);
  for (const dimension of DIMENSIONS) {
    const criteria = model.dimensions[dimension].criteria;
    const criterionWeight = Object.values(criteria).reduce((sum, value) => sum + Number(value), 0);
    if (Math.abs(criterionWeight - 1) > 0.000001) errors.push(`${dimension} criteria weights must total 1, got ${criterionWeight}`);
  }
  return { valid: errors.length === 0, errors, dimensions: DIMENSIONS.length };
}

export { model };
export default { scoreProject, rankPortfolio, allocatePortfolio, validateSelectionModel };
