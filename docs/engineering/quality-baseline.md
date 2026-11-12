# Testing baseline and error ledger

## Purpose

Establish an evidence-based baseline, record failures by exact commit and command, and reduce maintenance cost without weakening the single-owner runtime architecture.

## Current verified state

- Branch: `chore/test-baseline-error-ledger`.
- Draft PR: #288, based on `main`; not merged.
- Latest verified change: commit `aaa902caead52ae3ec2f9214e8769a5a22dc23d7` updates the runtime-discovery tests; CI for this commit is pending.
- Node target: 22.x.
- The default Jest configuration excludes `tests/platform/`, `tests/infrastructure/`, `tests/unit/phase9-approval-prompt.test.js`, and `tests/unit/phase9-terminal-boundary.test.js`. Separate CI commands cover some of these areas; audit their actual coverage before changing discovery.
- Latest observed CI run 43240878285 failed at the full Jest `Test` step; the remaining post-test jobs were skipped. The log reports 10 failed suites, 219 passed suites; 27 failed tests, 1,350 passed tests (1,377 total).
- Latest observed Vercel artifact workflow run 43240878245 passed.
- Latest observed secret scan run 43240878050 passed.
- Latest observed security run 43240877938 failed only its `npm audit` advisory-summary job; the independent security-check script passed.
- These are results for the run's tested commit, not a claim that failures are fixed on `main`.

## Error ledger

| ID | Commit / run | Command / job | Failure and evidence | Root cause / next investigation | Severity | Status |
|---|---|---|---|---|---|---|
| BASELINE-001 | Original run 43240410309; repaired run 43240878245 | Vercel deployment workflow | Original run failed with no job logs. Source review found malformed multiline shell conditional and duplicated trailing commands. Repaired workflow passed on commit `08916cac`. | Shell syntax defect fixed; keep workflow artifact-only so it does not compete with Vercel Git integration as deployment owner. | High | Fixed and rerun passed |
| BASELINE-002 | CI run 43240878285, commit `08916cac` | Full Jest step | 10/229 suites failed; 27/1,377 tests failed. Suites: `agentRuntime.test.js`, `skills/commerce-specialists.test.js`, `cordova/cordova-platform-parity.test.js`, `integration/inventory-specialist.test.js`, `mikrotik_logic.test.js`, `AgentOS.test.js`, `integration/inventory-approval-handoff.test.js`, `voucher-redemption-sqlite.test.js`, `commerce-payment-webhook.test.js`, `mikrotik.test.js`. | Split into subclusters below. Do not fix by disabling authorization gates or making disconnected hardware appear healthy. | High | Open |
| BASELINE-002A | CI run 43240878285 | AgentRuntime legacy discovery tests | Assertions expect `user.add` in `listTools()` and firewall names from `findTools()`, while the test itself says core defaults must remain domain-neutral and the implementation keeps legacy route hints separate from the canonical manifest. | Align assertions with the public contract: canonical tool listing must be registered capabilities; routing hints are not executable registrations. Add explicit tests that a route hint never becomes an executable tool without registry registration. | Medium | Open; likely stale test expectations, verify full test context before patch |
| BASELINE-002B | CI run 43240878285 | Inventory specialist and approval handoff | Errors include `approval_required`, `execution_task_required`, and inventory tenant-scope mismatch; expected risk/audit metadata does not match actual declarations. | First classify expected contract vs real regression. Preserve approval and tenant isolation; fix test fixtures/contracts only where the expectation is demonstrably obsolete. | Critical | Open |
| BASELINE-002C | CI run 43240878285 | Voucher SQLite redemption | Test logs show SQLite fallback was connected, but expected database provider registration was missing in at least one failing path. | Isolate provider selection and test setup. Assert the chosen backend and provider registration explicitly; avoid shared home-directory state leaking between tests. | High | Open |
| BASELINE-002D | CI run 43240878285 | Payment webhook reconciliation | Webhook test expects reconciliation updates but observes no expected updates. | Trace normalized event type/status, provider transaction lookup, database injection and callback wiring. Keep signature verification and transaction ownership checks intact. | High | Open |
| BASELINE-002E | CI run 43240878285 | MikroTik logic and client tests | Mocks expect command calls / rejection, but implementation returns empty/default stats or resolves despite disconnected state. | Decide contract: disconnected network must be observable as unavailable, not silently treated as healthy. Fix adapter or mocks to match that contract; never use a fake success fallback in production. | High | Open |
| BASELINE-002F | CI run 43240878285 | Cordova parity and AgentOS top-level suite | Cordova test uses `.rejects` on an undefined result; AgentOS suite also has failing assertions not yet isolated. | Inspect exported API and platform-unavailable fallback contract; split AgentOS assertions by first failure. | Medium | Open |
| BASELINE-003 | Security run 43240877938 | npm audit advisory summary | High advisories include `@grpc/grpc-js` (resolved range <=1.13.5; GHSA-m9gg-hp2v-232j and GHSA-f596-whhp-79r4), `js-yaml` (4.0.0–4.3.1; GHSA-2883-xcg3-v3hh), direct `pm2` (5.4.0–7.0.4), and `zod` (<4.6.6; GHSA-mrhx-c7xc-m3w5). Summary job fails; separate security-check script and secret scan pass. | Inspect lockfile-resolved dependency paths and compatibility. Prefer a targeted, non-breaking update first; do not use `npm audit fix --force` without reviewing major-version changes and test impact. | High | Open |
| BASELINE-004 | Initial dependency scan on branch | Dependency usage report | Initial scanner included root `package.json`, so every declared dependency self-matched and the report was useless. | Scanner updated to exclude the manifest being measured. Verify the artifact from the latest run before trusting candidate counts. | Medium | Scanner fixed; latest report pending review |

## Investigation order

1. Preserve logs and isolate failing tests. Work in small groups; record the first failing assertion and the actual returned value.
2. Start with inventory authorization/approval failures because those affect safety boundaries. Determine whether the code or fixture is wrong before changing behavior.
3. Fix runtime discovery tests to distinguish *routing hints* from *registered executable capabilities*.
4. Isolate payment and voucher database setup; use injected test databases rather than mutable shared state.
5. Fix MikroTik disconnect semantics so errors are explicit and never reported as successful empty data.
6. Resolve the Cordova contract mismatch and then rerun the full suite.
7. Remediate npm advisories in a separate lockfile-focused change, rerunning relevant provider tests and full CI.
8. Review the dependency usage artifact, then remove one proven-unused dependency at a time with lockfile update, clean install, build and tests.

## Bloat policy

- The repository currently declares 87 production, 44 development and 1 optional dependency (132 entries total). This is a review queue, not evidence that 132 packages are unnecessary.
- The usage report is heuristic only. Verify dynamic imports, plugin manifests, Cordova configuration, scripts, build tooling, optional integrations, and published package requirements.
- No dependencies are removed by the scanner.
- Consolidate duplicate execution/gateway paths only after entry-point mapping and regression tests prove behavioral parity.
- Do not delete test coverage, weaken authorization, or suppress errors to improve the score.

## Exit criteria

- All CI jobs are green, or remaining failures are explicitly classified with evidence and an owner.
- No new runtime execution owner or authorization bypass is introduced.
- Every dependency removal has a usage rationale and passing install/build/test evidence.
- The ledger reflects the exact tested commit.
