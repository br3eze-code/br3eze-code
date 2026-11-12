# Testing baseline and error ledger

## Purpose

Establish an evidence-based baseline for `main`, record failures by exact commit and command, and reduce maintenance cost without weakening the single-owner runtime architecture.

## Baseline status

- Repository default branch: `main`.
- Node target: 22.x.
- The package's default Jest configuration excludes `tests/platform/`, `tests/infrastructure/`, `tests/unit/phase9-approval-prompt.test.js`, and `tests/unit/phase9-terminal-boundary.test.js`.
- CI defines separate checks for serving, authorization, auth, infrastructure, Node-native tests, syntax, types, and security. A green `npm test` alone is not a complete pass.
- Source review found a malformed shell `if` block in `.github/workflows/vercel-deploy.yml`; the branch fixes the conditional and removes duplicated trailing commands. The earlier push-triggered run failed and exposed no jobs; verification of the repaired workflow is pending.
- Observed on commit `1c323c2a095e2f47833104098e4ee73a38590eb9`: Jest reported 10 failed suites, 219 passed suites; 27 failed tests and 1,350 passed tests.
- Observed on the same commit: security workflow's npm-audit summary failed; the separate repository security-check job and secret scan passed.
- These results are a baseline for that commit, not results for the latest branch head.

## Error ledger

| ID | Commit / run | Command / job | Failure and evidence | Root cause | Severity | Status |
|---|---|---|---|---|---|---|
| BASELINE-001 | Original branch run 43240410309 | Vercel deployment workflow | Workflow run failed; API returned zero jobs. Source review found malformed multiline shell conditional and duplicate trailing commands in the workflow file. | Invalid shell block in deployment validation step; rerun required to confirm fix | High | Fix committed on this branch; rerun pending |
| BASELINE-002 | Commit 1c323c2; CI run 43240430893 | Jest full test step | 10/229 suites failed; 27/1,377 tests failed. Failing suites: `agentRuntime.test.js`, `skills/commerce-specialists.test.js`, `cordova/cordova-platform-parity.test.js`, `integration/inventory-specialist.test.js`, `mikrotik_logic.test.js`, `AgentOS.test.js`, `integration/inventory-approval-handoff.test.js`, `voucher-redemption-sqlite.test.js`, `commerce-payment-webhook.test.js`, `mikrotik.test.js`. | Multiple root causes likely. Confirmed clusters: missing registered DB provider in voucher SQLite tests; webhook reconciliation records no expected updates; MikroTik methods return default/empty results instead of rejecting when disconnected. Remaining suites require isolated reruns. | High | Open; investigate in small batches |
| BASELINE-003 | Commit 1c323c2; security run 43240431168 | npm audit advisory summary | Audit summary failed. High-severity findings included Firebase / Firestore packages, `@grpc/grpc-js`, `js-yaml`, `pm2`, and `zod`; additional moderate/low advisories were also reported. The separate repository security-check job passed. | Dependency-tree advisories; exact resolved versions and safe upgrade paths need review before updates | High | Open; do not blanket-downgrade or blindly force-fix |
| BASELINE-004 | Commit 1c323c2; dependency audit artifact 13953374841 | Dependency usage report | Initial report was invalid as a bloat signal because the scanner included root `package.json`, which declares every dependency and therefore self-matched every name. | Scanner included the manifest it was measuring | Medium | Fix committed on this branch; rerun required |

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
