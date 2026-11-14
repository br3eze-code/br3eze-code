# Model Fine-Tuning Coach

A dependency-free AgentOS skill for planning and checking a first reproducible open-weight fine-tuning experiment. It does not download models, start GPU jobs, or modify model weights; it provides planning, dataset sanity checks, budget gates, and metric comparisons.

## Actions

Invoke with `{ action: "..." }`:

- `plan_experiment`: returns a four-phase starter plan with guardrails and success criteria.
- `validate_dataset`: checks instruction/output fields, empty splits, duplicate prompts, simple train/evaluation prompt leakage, and a few privacy warning heuristics.
- `check_budget`: compares estimated or actual cost with a hard user-provided USD limit.
- `evaluate_results`: compares baseline and tuned task-success, format-compliance, and safety-compliance rates. It only marks a result as improved when the same evaluation set was used, task success increased, and neither format nor safety rate regressed.

## Dataset input

Either pass separate arrays:

```js
{
  action: "validate_dataset",
  training: [{ instruction: "Classify this fictional support request", input: "Wi-Fi is unavailable", output: "category: connectivity" }],
  evaluation: [{ instruction: "Classify this fictional support request", input: "Voucher did not work", output: "category: voucher" }]
}
```

Or pass `examples` where each row has `instruction`, `output`, optional `input`, and `split` equal to `train`, `evaluation`, or `test`.

## Safety and limitations

- No network, filesystem, shell, model loading, or GPU execution.
- No automatic spending or external side effects.
- Dataset checks are heuristics; they do not certify license, consent, privacy, or quality.
- The evaluation gate is intentionally conservative and does not replace manual review or a task-specific benchmark.
- The budget action only evaluates numbers supplied by the caller; it cannot inspect cloud billing.
