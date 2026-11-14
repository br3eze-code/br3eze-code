'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const skill = require('../../skills/model-finetuning-coach/index.cjs');

test('plan_experiment returns a bounded four-phase starter plan', async () => {
  const result = await skill.execute({ action: 'plan_experiment', budgetUsd: 20, hoursPerWeek: 5 });
  assert.equal(result.status, 'planned');
  assert.equal(result.phases.length, 4);
  assert.equal(result.budgetUsd, 20);
  assert.ok(result.guardrails.length >= 4);
});

test('validate_dataset detects prompt leakage and missing fields', async () => {
  const result = await skill.execute({
    action: 'validate_dataset',
    training: [{ instruction: 'Classify request', input: 'wifi down', output: 'connectivity' }],
    evaluation: [{ instruction: 'Classify request', input: 'wifi down', output: '' }]
  });
  assert.equal(result.valid, false);
  assert.equal(result.leakageCount, 1);
  assert.ok(result.issues.some(issue => issue.includes('output')));
});

test('check_budget pauses when projected spend exceeds limit', async () => {
  const result = await skill.execute({ action: 'check_budget', limitUsd: 10, estimatedCostUsd: 12 });
  assert.equal(result.allowed, false);
  assert.equal(result.action, 'pause_and_review');
});

test('evaluate_results requires same evaluation set and no format/safety regression', async () => {
  const result = await skill.execute({
    action: 'evaluate_results',
    sameEvaluationSet: true,
    baseline: { taskSuccessRate: 0.5, formatPassRate: 0.9, safetyPassRate: 1 },
    tuned: { taskSuccessRate: 0.7, formatPassRate: 0.9, safetyPassRate: 1 }
  });
  assert.equal(result.gatePassed, true);
  assert.equal(result.comparisons.taskSuccessRate.delta, 0.2);
});

test('unknown action fails explicitly', async () => {
  await assert.rejects(() => skill.execute({ action: 'not-real' }), /Unsupported action/);
});
