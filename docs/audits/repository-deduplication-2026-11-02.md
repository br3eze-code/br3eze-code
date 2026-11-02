# Repository deduplication and pipeline cleanup — 2026-11-02

## Verified baseline and result

- Baseline tracked files: 2,428.
- Current tracked files: 2,379.
- Files removed: 49.
  - 5 redundant workflow definitions.
  - 44 zero-byte generated security-audit `.err` files.
- Workflow definitions reduced from 27 to 22.

## Workflow consolidation

Removed:
- `.github/workflows/node.js.yml`: duplicate of canonical `ci.yml`.
- `.github/workflows/cicd-contract.yml`: its contract validation already runs inside `ci.yml`.
- `.github/workflows/llm-js-training.yml`, `general-transformer.yml`, and `knowledge-foundation.yml`: their checks are consolidated into `llm-js.yml`.

Updated:
- `ci.yml` remains the canonical root CI workflow.
- `llm-js.yml` now includes transformer, knowledge, dataset-preparation and RouterOS-lab checks.
- `repo-data-training.yml` is manual-only to avoid running training on every experiment change.
- `release.yml` and `npm-canary.yml` are manual-only; publishing is no longer triggered by every push to main.
- `deploy.yml` is manual-only because its Kubernetes path is not the verified production deployment target.
- `vercel-deploy.yml` runs only for main and pull requests targeting main.
- `firebase-deploy.yml` runs on main only when Firebase-owned paths change; the duplicate Release workflow trigger was removed.
- `docker.yml` runs on main only for runtime/container-relevant changes; version-tag publishing remains in `docker-release.yml`.
- `dependency-sync.yml` is path-scoped to package manifests/lockfiles and no longer dispatches the deleted CI/CD contract workflow.

## Remaining exact-content duplicates

The Git tree content-hash audit still finds 26 duplicate-content groups containing 75 extra identical copies. These are not all safe deletions:
- Generated security-review JSON snapshots: retain provenance until the audit output format is consolidated.
- PHP domain/skill fallback entrypoints: identical generic response handlers, but URLs may be externally consumed.
- Duplicate browser JS assets: verify HTML/Cordova references before removing aliases.
- Duplicate server route files and persistence helpers: inspect imports and compatibility callers before consolidation.
- Case-only calendar skill duplicate and duplicated favicon asset: verify loader/platform behavior first.

No source/runtime files were deleted solely because their contents matched.

## Legacy code candidate

Root `agentos.js` is an old network-specific monolith. The live CLI path uses `bin/agentos.js` → `main.js`; package publishing excludes the root monolith. The audit skill still reads it as an input. Archive or remove it only after comparing its remaining unique behavior with maintained adapters and updating the audit collector.

## Branch inventory

There are 60 branches. 37 point to the same old commit `9c51352ab00c8916f90a91bd6e58c1f0fa04bcaf`, which is behind current main and has no unique commits relative to main. Those 37 refs are absorbed/stale. The other 23 branch heads need individual PR/unique-work review before deletion.

## Validation status

GitHub Actions were queued/pending on the latest cleanup commit at the time of this audit. This report does not claim green CI. The next gate is completion of canonical CI, quality, security, Docker and Vercel checks.
