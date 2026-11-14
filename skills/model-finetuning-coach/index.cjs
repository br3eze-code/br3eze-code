'use strict';

const DEFAULT_LIMITS = Object.freeze({
  starterTrainExamples: 100,
  starterEvalExamples: 30,
  maxBudgetUsd: 25,
  minimumEvaluationCases: 30,
});

function asFiniteNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${field} must be a finite number`);
  return number;
}

function planExperiment(params = {}) {
  const budgetUsd = params.budgetUsd == null
    ? DEFAULT_LIMITS.maxBudgetUsd
    : asFiniteNumber(params.budgetUsd, 'budgetUsd');
  const hoursPerWeek = params.hoursPerWeek == null
    ? 5
    : asFiniteNumber(params.hoursPerWeek, 'hoursPerWeek');

  if (budgetUsd < 0) throw new RangeError('budgetUsd must be >= 0');
  if (hoursPerWeek <= 0) throw new RangeError('hoursPerWeek must be > 0');

  const task = typeof params.task === 'string' && params.task.trim()
    ? params.task.trim()
    : 'Convert a fictional Wi-Fi support question into a structured troubleshooting response';

  return {
    status: 'planned',
    task,
    budgetUsd,
    hoursPerWeek,
    estimatedDurationWeeks: hoursPerWeek >= 5 ? 4 : 6,
    phases: [
      { week: 1, name: 'Baseline', tasks: ['Choose an open-weight model and verify its license', 'Run a small fixed set of prompts', 'Save model ID, revision, outputs, and environment details'], gate: 'Baseline outputs are reproducible' },
      { week: 2, name: 'Dataset', tasks: ['Prepare 100–300 checked training examples', 'Keep 30–50 evaluation examples separate before training', 'Check duplicates, formatting, provenance, and sensitive data'], gate: 'Dataset review passes and evaluation set remains untouched' },
      { week: 3, name: 'Adapter training', tasks: ['Run supervised fine-tuning with LoRA using established libraries', 'Record configuration, logs, runtime, and actual cost', 'Save and reload the adapter in a fresh process'], gate: 'Adapter reloads and inference completes' },
      { week: 4, name: 'Evaluation', tasks: ['Run baseline and tuned model on identical held-out examples', 'Score task success, format compliance, failure cases, latency, and cost', 'Publish a concise experiment report'], gate: 'A measured comparison exists; improvement is not assumed' }
    ],
    guardrails: [
      'Do not train a foundation model from scratch for this first experiment.',
      'Do not buy compute until the provider, price, limits, and shutdown behavior are understood.',
      'Do not put real customer data, credentials, or private records into training examples.',
      'Stop or pause if projected spend exceeds the budget.',
      'A failed experiment is acceptable if its result is measured and documented.'
    ],
    successCriteria: [
      'The run can be repeated from documented instructions.',
      'The saved adapter can be reloaded.',
      'Baseline and tuned results use the same held-out examples.',
      'The report distinguishes measured facts from assumptions.'
    ]
  };
}

function normalise(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function validateDataset(params = {}) {
  const training = Array.isArray(params.training) ? params.training : [];
  const evaluation = Array.isArray(params.evaluation) ? params.evaluation : [];
  const examples = Array.isArray(params.examples) ? params.examples : null;
  const issues = [];
  const warnings = [];
  const seenTrain = new Set();
  const seenEval = new Set();
  let trainCount = training.length;
  let evalCount = evaluation.length;

  if (examples) {
    trainCount = 0;
    evalCount = 0;
    for (const [index, example] of examples.entries()) {
      if (!example || typeof example !== 'object' || Array.isArray(example)) {
        issues.push(`examples[${index}] must be an object`);
        continue;
      }
      if (!['train', 'evaluation', 'test'].includes(example.split)) {
        issues.push(`examples[${index}].split must be train, evaluation, or test`);
      } else if (example.split === 'train') trainCount += 1;
      else evalCount += 1;
    }
  } else if (!Array.isArray(params.training) || !Array.isArray(params.evaluation)) {
    issues.push('Provide either examples[] with a split field, or both training[] and evaluation[] arrays');
  }

  function inspect(list, splitName, seen) {
    list.forEach((example, index) => {
      if (!example || typeof example !== 'object' || Array.isArray(example)) {
        issues.push(`${splitName}[${index}] must be an object`);
        return;
      }
      if (typeof example.instruction !== 'string' || !example.instruction.trim()) {
        issues.push(`${splitName}[${index}].instruction must be a non-empty string`);
      }
      if (typeof example.output !== 'string' || !example.output.trim()) {
        issues.push(`${splitName}[${index}].output must be a non-empty string`);
      }
      const key = normalise(example.instruction) + '|' + normalise(example.input);
      if (seen.has(key)) warnings.push(`Duplicate prompt/input in ${splitName} at index ${index}`);
      seen.add(key);
      const combined = [example.instruction, example.input, example.output].filter(Boolean).join(' ');
      if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(combined)) {
        warnings.push(`${splitName}[${index}] resembles an email address; review privacy manually`);
      }
      if (/\b(?:\+?\d[\d ()-]{7,}\d)\b/.test(combined)) {
        warnings.push(`${splitName}[${index}] resembles a phone number; review privacy manually`);
      }
    });
  }

  if (examples) {
    inspect(examples.filter(item => item && item.split === 'train'), 'training', seenTrain);
    inspect(examples.filter(item => item && ['evaluation', 'test'].includes(item.split)), 'evaluation', seenEval);
  } else {
    inspect(training, 'training', seenTrain);
    inspect(evaluation, 'evaluation', seenEval);
  }

  const trainPrompts = new Set((examples
    ? examples.filter(item => item && item.split === 'train')
    : training).map(item => normalise(item?.instruction) + '|' + normalise(item?.input)));
  const evalExamples = examples
    ? examples.filter(item => item && ['evaluation', 'test'].includes(item.split))
    : evaluation;
  const leakageCount = evalExamples.filter(item => trainPrompts.has(normalise(item?.instruction) + '|' + normalise(item?.input))).length;
  if (leakageCount > 0) issues.push(`${leakageCount} evaluation prompt/input pair(s) also appear in training data`);

  if (trainCount < DEFAULT_LIMITS.starterTrainExamples) warnings.push(`Training set has fewer than the starter target of ${DEFAULT_LIMITS.starterTrainExamples}; this is a heuristic, not a hard minimum`);
  if (evalCount < DEFAULT_LIMITS.starterEvalExamples) warnings.push(`Evaluation set has fewer than the starter target of ${DEFAULT_LIMITS.starterEvalExamples}; results may be noisy`);
  if (trainCount === 0) issues.push('Training set is empty');
  if (evalCount === 0) issues.push('Evaluation set is empty');

  return {
    valid: issues.length === 0,
    counts: { training: trainCount, evaluation: evalCount },
    leakageCount,
    issues: [...new Set(issues)],
    warnings: [...new Set(warnings)],
    privacyReviewRequired: true,
    note: 'Automated checks are only a first pass; they do not prove dataset quality, licensing, consent, or absence of personal data.'
  };
}

function checkBudget(params = {}) {
  const limitUsd = asFiniteNumber(params.limitUsd, 'limitUsd');
  const estimatedCostUsd = asFiniteNumber(params.estimatedCostUsd, 'estimatedCostUsd');
  const actualCostUsd = params.actualCostUsd == null ? null : asFiniteNumber(params.actualCostUsd, 'actualCostUsd');
  if (limitUsd < 0 || estimatedCostUsd < 0 || (actualCostUsd != null && actualCostUsd < 0)) {
    throw new RangeError('Budget and cost values must be >= 0');
  }
  const projectedUsd = actualCostUsd == null ? estimatedCostUsd : actualCostUsd;
  const allowed = projectedUsd <= limitUsd;
  return {
    allowed,
    limitUsd,
    estimatedCostUsd,
    actualCostUsd,
    projectedUsd,
    remainingUsd: Math.max(0, limitUsd - projectedUsd),
    action: allowed ? 'continue_with_cost_logging' : 'pause_and_review',
    message: allowed ? 'Projected or actual cost is within the declared limit.' : 'Budget limit exceeded; pause the run and review before spending more.'
  };
}

function evaluateResults(params = {}) {
  const baseline = params.baseline;
  const tuned = params.tuned;
  if (!baseline || !tuned || typeof baseline !== 'object' || typeof tuned !== 'object') {
    throw new TypeError('baseline and tuned metric objects are required');
  }
  const sameEvaluationSet = params.sameEvaluationSet === true;
  const metrics = ['taskSuccessRate', 'formatPassRate', 'safetyPassRate'];
  const comparisons = {};
  for (const metric of metrics) {
    const before = Number(baseline[metric]);
    const after = Number(tuned[metric]);
    if (!Number.isFinite(before) || !Number.isFinite(after) || before < 0 || before > 1 || after < 0 || after > 1) {
      comparisons[metric] = { comparable: false, reason: 'Provide both values as proportions from 0 to 1' };
    } else {
      comparisons[metric] = { comparable: true, baseline: before, tuned: after, delta: after - before };
    }
  }
  const comparable = Object.values(comparisons).filter(item => item.comparable);
  const task = comparisons.taskSuccessRate;
  const regressions = ['formatPassRate', 'safetyPassRate'].filter(key =>
    comparisons[key].comparable && comparisons[key].delta < 0
  );
  const gatePassed = sameEvaluationSet &&
    task?.comparable === true &&
    task.delta > 0 &&
    regressions.length === 0;

  return {
    gatePassed,
    sameEvaluationSet,
    comparisons,
    regressions,
    status: !sameEvaluationSet
      ? 'invalid_comparison'
      : gatePassed
        ? 'candidate_improved_on_measured_metrics'
        : 'improvement_not_demonstrated',
    caveats: [
      'Rates are descriptive, not proof of general capability.',
      'A positive result on a small test set may be noisy.',
      'Review representative failures manually before release.',
      'This gate does not assess model license, security, factuality, or broad safety unless those are separately tested.'
    ]
  };
}

async function execute(params = {}) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new TypeError('params must be an object');
  }
  const action = params.action || 'plan_experiment';
  switch (action) {
    case 'plan_experiment': return planExperiment(params);
    case 'validate_dataset': return validateDataset(params);
    case 'check_budget': return checkBudget(params);
    case 'evaluate_results': return evaluateResults(params);
    default: throw new RangeError(`Unsupported action '${action}'. Supported actions: plan_experiment, validate_dataset, check_budget, evaluate_results`);
  }
}

module.exports = { execute, planExperiment, validateDataset, checkBudget, evaluateResults };
