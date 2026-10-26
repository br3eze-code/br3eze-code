# Branch pattern recovery ledger

Base: `main` at the start of the recovery pass. Working branch: `port/missing-branch-patterns`.

This is a file-by-file recovery, not a wholesale branch merge. Re-run GitHub comparisons before final merge because branch heads can move. A branch that is behind `main` with zero ahead commits contributes no unique committed file changes at the compared head; this does not prove every idea in its old PR discussion was implemented.

## Source branch inventory

| Source branch | Comparison against main | Recovery decision |
| --- | --- | --- |
| `feat/commercial-domain-agnostic-platform` | 0 ahead, 16 behind | No unique committed file diff at current head. Review old PR discussion only if an unmet acceptance criterion remains. |
| `feat/general-purpose-transformer` | 30 ahead, 2 behind | Ported overlapping Transformer/GPT files from the more complete `feat/llm-js-training` source: attention, general transformer, GPT, layers, model, ops, tensor, training and tests. |
| `feat/hitl-delegation-full-state` | 0 ahead, 93 behind | No unique committed file diff at current head. Historical PR #209 reports unresolved test/security blockers; do not re-import stale branch history. |
| `feat/llm-js-training` | 138 ahead, 2 behind | Ported lab files individually: workflows, data builder, attention/tensor/ops/layers/model/Transformer/GPT, optimizer, training, fine-tuning, open-model harness, policy, fixtures, and tests. |
| `feat/nodejs-microgpt-foundation` | 3 ahead, 2 behind | Ported autograd implementation, regression tests, and architecture notes. Fixed the zero-input, zero-power derivative edge case. |
| `feat/nodejs-model-training-pipeline` | 21 ahead, 2 behind | Ported classifier implementation, tool adapter, CLI scripts, sample JSONL, tests, and architecture guide. Reconciled package scripts and ignore rules. |
| `fix/production-baseline-75` | 11 ahead, 0 behind | Ported repository-hygiene gate and tests. Reconciled its npm script and lockfile-ignore behavior. Signing keystore and local environment files are not reintroduced. |
| `refactor/general-purpose-single-runtime` | 0 ahead, 78 behind | No unique committed file diff at current head. Re-check live runtime paths and historical review notes before claiming single-runtime consolidation is complete. |
| `v0/br3eze-code-22012066` | 1 ahead, 162 behind | Only unique diff reported is `package-lock.json`. Deferred wholesale lockfile replacement pending dependency-manifest consistency and reproducible npm install; do not port stale dependency resolution blindly. |

## Additional open-PR patterns recovered

- From PR #215, removed tracked local AI settings, a Podman environment file containing a gateway token, the release keystore, and stale logs from this proposed tree. This does **not** purge those artifacts from Git history; rotate exposed credentials and signing material.
- Ported PR #215's CI hygiene checks, domain-neutral default-tool cleanup, skill registration through the canonical ToolRegistry, and associated focused tests.
- Added `experiments/llm-js/verify-training.js` from PR #211, which was absent from the first pass.
- PRs #212 and #214 overlap on the autograd files; the consolidated branch keeps the corrected #214 implementation once, rather than duplicating the same feature.

## Files added or reconciled on this branch

- `.github/workflows/llm-js.yml`
- `.github/workflows/repo-data-training.yml`
- `experiments/llm-js/**` — training code, model components, fine-tuning helpers, fixtures, and tests
- `src/llm/autograd.js`, `tests/unit/autograd.test.js`, `docs/architecture/nodejs-microgpt.md`
- `src/ml/trainable-classifier.js`, `src/ml/classifier-tool.js`, `scripts/train-model.mjs`, `scripts/predict-model.mjs`, `tests/unit/trainable-classifier.test.js`
- `docs/architecture/nodejs-model-training.md`, `examples/model-training/triage.jsonl`
- `scripts/repository-hygiene-gate.mjs`, `scripts/repository-hygiene-gate.test.mjs`
- Reconciled `package.json`, `.gitignore`, and `README.md`

## Outstanding gates

1. Run the Node.js test workflow, including all `experiments/llm-js/*.test.js` tests and the tiny train/resume/fine-tune smoke paths.
2. Run the classifier tests, repository-hygiene checks, syntax/build checks, full production suite, and architecture/security gates.
3. Resolve the Vercel status failure caused by the observed build-rate limit; do not treat a rate-limit failure as a successful build.
4. Revisit PR #209 and runtime-consolidation history for requirements not represented in the current branch diff.
5. Review whether training-corpus redaction/exclusion is sufficient for the repository's actual contents before running repository-data training.
6. Do not merge into `main` until required checks pass and the lockfile/package-manifest state is deliberately resolved.

## Claims we do not make

The scalar autograd foundation is not itself a GPT. A tiny smoke-training run is not evidence of a capable conversational model. The classifier is not the GPT. AgentRuntime remains the only intended production execution owner; experimental model code must not become a second agent runtime.
