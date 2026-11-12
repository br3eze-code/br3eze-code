# Testing baseline and error ledger

## Purpose

Establish an evidence-based baseline for `main`, record failures by exact commit and command, and reduce maintenance cost without weakening the single-owner runtime architecture.

## Baseline status

- Repository default branch: `main`.
- Node target: 22.x.
- The package's default Jest configuration excludes `tests/platform/`, `tests/infrastructure/`, `tests/unit/phase9-approval-prompt.test.js`, and `tests/unit/phase9-terminal-boundary.test.js`.
- CI defines separate checks for serving, authorization, auth, infrastructure, Node-native tests, syntax, types, and security. A green `npm test` alone is not a complete pass.
- Source review found a malformed shell `if` block in `.github/workflows/vercel-deploy.yml`; the branch fixes the conditional and removes duplicated trailing commands. The push-triggered run for the original branch commit failed and exposed no jobs, so its exact failure reason is not proven from job logs.
- Full CI and security results for this PR are pending. Do not treat prior audit counts as current results.

## Error ledger

| ID | Commit / run | Command / job | Failure and evidence | Root cause | Severity | Status |
|---|---|---|---|---|---|---|
| BASELINE-001 | Original branch run 43240410309 | Vercel deployment workflow | Workflow run failed; API returned zero jobs. Source review found malformed multiline shell conditional and duplicate trailing `fi`/commands in the workflow file. | Invalid shell block in deployment validation step; confirm with the rerun after patch | High | Fix committed on this branch; rerun pending |
| BASELINE-002 | PR #288 head | Full GitHub Actions workflow | CI and security jobs started; no final test results captured yet | Pending | Unknown | In progress |

For each failure, record the first actionable stack trace or assertion, affected test, reproducible command, root cause, minimal fix, regression test, and verification commit. Keep secrets, tokens, user data, and unredacted environment dumps out of the ledger.

## Required verification sequence

1. Run the existing GitHub Actions workflow on this branch and capture every failing job.
2. Re-run each failure in isolation before changing implementation.
3. Include the excluded platform and infrastructure suites in the report; do not silently change Jest discovery semantics without confirming CI coverage.
4. After fixes, rerun the failing test, relevant boundary tests, and full workflow on the same commit.
5. Record pass/fail and commit SHA. Do not claim a fix from a local-only or partial run.

## Bloat policy

- Run the dependency usage report attached to CI. It is a heuristic, not a deletion list.
- For each candidate, verify static and dynamic imports, plugin manifests, Cordova configuration, scripts, build tooling, optional integrations, and published package requirements.
- Remove dependencies only in a separate minimal change with lockfile updates and a clean install/build/test.
- Consolidate duplicate execution/gateway paths only after entry-point mapping and regression tests prove behavioral parity.
- Do not delete test coverage, weaken authorization, or suppress errors to improve the score.

## Exit criteria

- All CI jobs are green, or remaining failures are explicitly classified with evidence and owners.
- No new runtime execution owner or authorization bypass is introduced.
- Every dependency removal has a usage rationale and passing install/build/test evidence.
- Error ledger reflects the tested commit, not an earlier branch snapshot.
