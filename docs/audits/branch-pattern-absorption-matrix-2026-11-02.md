# Branch Pattern Absorption Matrix — 2026-11-02

Canonical destination: `main`
Rule: compare every distinct branch head against current `main`; preserve every unique pattern either as a canonical implementation, an isolated experiment, or an explicit rejected-pattern record. Never treat "not merged" as "worth merging", and never treat path presence alone as behavioural absorption.

## Status definitions

- **FULL** — contribution is in main's commit ancestry or exact source/test content is verified equivalent.
- **PARTIAL** — some paths/patterns are present, but remaining diffs or behavioural tests are outstanding.
- **NOT ABSORBED** — unique contribution has not been ported or explicitly dispositioned.
- **REVIEW / REJECT** — contribution has been traced, but must not enter production unchanged (e.g. secrets, generated audit output, unsafe permissions, stale dependency lockfile).

## Branch population

At the branch snapshot used for this audit:
- 60 branch refs including main.
- 24 distinct branch-head SHAs including main.
- 37 branch refs share one head SHA: `9c51352ab00c8916f90a91bd6e58c1f0fa04bcaf`. That head is 0 commits ahead of main and 95 behind; these 37 names are duplicate aliases, not 37 independent code contributions.
- 22 other distinct non-main heads require individual trace.
- 11 open PRs require separate PR-head mapping; branch-head review alone does not close PRs.

## Distinct branch-head trace

| Branch / branch group | Head SHA (short) | Compare against main | Unique contribution | Disposition |
|---|---|---:|---|---|
| dependabot Babel 8 | `55f024a` | 1 ahead | package.json + lockfile | REVIEW: major toolchain change; validate Node/Jest/Babel before adopting |
| dependabot Express 5.3 | `ae37047` | 1 ahead | package.json + lockfile | REVIEW: test server/API compatibility before adopting |
| dependabot follow-redirects root | `c122b04` | 1 ahead | package-lock only | REVIEW: confirm root manifest and lock consistency |
| dependabot google-auth-library 11 | `03f8c0a` | 1 ahead | package.json + lockfile | REVIEW: auth adapter regression tests required |
| dependabot Joi 18.3 | `21ea670` | 1 ahead | package.json + lockfile | REVIEW: compare with current main version/lockfile |
| dependabot multi-package batch | `896d0f4` | 1 ahead | package.json + lockfile | REVIEW: split updates to isolate regressions |
| dependabot rate-limiter-flexible 11 | `277fa66` | 1 ahead | package.json + lockfile | REVIEW: major API/security behaviour tests |
| dependabot follow-redirects server | `163e214` | 1 ahead | server/package-lock only | REVIEW: verify server manifest lock parity |
| dependabot systeminformation | `74db103` | 1 ahead | package-lock only | REVIEW: verify manifest/lock parity |
| docs current-main-verification-status | `2aa79bf` | 2 ahead | README evidence/status update | PARTIAL: content must be reconciled with current CI/deployment evidence |
| docs readme-evidence-status | `e1bc60b` | 1 ahead | README evidence/status update | PARTIAL: merge unique evidence, not stale claims |
| feat autonomous-operator-foundation | `1539986` | 39 ahead | 21 changed paths: task/WBS/A2A/orchestration, stores, tests, workflows, audit scripts | NOT ABSORBED: high-priority file-by-file semantic comparison |
| feat supplier-provisioning-transaction-guards | `9315b73` | 7 ahead | A2A policy modification + supplier provisioning module + tests | NOT ABSORBED: inspect transaction/idempotency and tenant guards |
| patch security-hardening-2026-11 | `d2bd8a0` | 8 ahead | security policy/checks and regression tests | NOT ABSORBED: compare fail-closed semantics; do not replace current controls blindly |
| port missing branch patterns | `c072940` | 132 ahead | large mixed set: Node transformer, training, hygiene, adapters, payments, tests, docs, workflows | NOT ABSORBED: split by subsystem; do not cherry-pick the entire branch |
| port nodejs autograd current main | `3372cb2` | 6 ahead; compare reported no file list | autograd/model training lineage | REVIEW: verify tree/blob equality and commit ancestry; do not infer full absorption from empty compare file list |
| port security hygiene current main | `d8acac3` | 11 ahead | hygiene gate, ignore rules, secret/log removal, CI changes | PARTIAL: hygiene gate exists on main; verify exact gate tests and ignore rules; secret/log removals are already expected hygiene |
| refactor general-purpose single-runtime | `37b633f` | 53 ahead | Level 2, Node LLM, hardware, lifecycle, delegation, approval, provider boundary, tests | NOT ABSORBED: compare canonical runtime and each new subsystem independently |
| refactor Linux single-runtime boundaries | `e1c1f10` | 63 ahead | Level 2 supervisor, app manifests, IPC, local state, platform registry, host/hardware adapters, tests and architecture docs | PARTIAL: several patterns already exist; some paths are absent; see focused trace below |
| Snyk security upgrade | `ab020f3` | 1 ahead | package.json dependency change | REVIEW: inspect exact dependency and lockfile before adoption |
| test persistence and MikroTik adapter paths | `6256a67` | 3 ahead | MikroTik and SQLite fallback tests | NOT ABSORBED: test deltas need review and execution |
| v0/br3eze-code-22012066 | `5fbe011` | 1 ahead | package-lock only | REVIEW: stale lockfile candidate; compare against current manifest |

## 37 duplicate branch refs sharing one head

All below point to `9c51352ab00c8916f90a91bd6e58c1f0fa04bcaf`; do not count each as separate work:
- feat/commercial-domain-agnostic-platform
- feat/general-purpose-transformer
- feat/hitl-delegation-full-state
- feat/jvm-style-portable-runtime
- feat/kernel-first-main
- feat/knowledge-connectors-index
- feat/knowledge-connectors-index-rebased
- feat/level2-platform-foundation
- feat/level3-linux-distro
- feat/level-3-linux-distribution
- feat/level-3-linux-distribution-foundation
- feat/llm-js-training
- feat/multimodal-knowledge-foundation
- feat/networking-corpus-pipeline
- feat/nodejs-microgpt-foundation
- feat/nodejs-model-training-pipeline
- feat/standalone-general-transformer
- feat/wikimedia-source-adapter
- fix/accounting-ci-lockfile-flags
- fix/ci-baseline-contracts-2026-10-30
- fix/ci-deployment-root-causes
- fix/ci-test-contracts-2026-10-30
- fix/main-ci-syntax-release-publish
- fix/network-facade-domain-tests
- fix/os-image-distro-mode
- fix/payment-adapter-compatibility
- fix/platform-lifecycle-and-tests
- fix/production-baseline-75
- fix/skill-fast-path-and-mikrotik-tests
- merge/nodejs-autograd-foundation
- port/delegation-and-provider-contracts
- port/deployment-root-causes-after-network-fix
- port/hardware-capability-runtime-current-main
- port/knowledge-foundation-current-main
- port/level2-platform-file-by-file
- port/level2-platform-foundation-current-main
- port/llm-training-workflows-main

Disposition: **FULL by ancestry for this shared head** (0 commits ahead of main); no separate port should be repeated for these 37 refs. This does not prove that every PR title pointing to similar work is closed.

## Focused tree/blob trace: refactor/linux-single-runtime-boundaries

Compared branch tree `e1c1f10` against main's tree (not just the compare endpoint's merge-base file list).

### Exact same blobs verified on main
- `src/core/os/ApplicationManager.js`
- `src/core/os/IPCMessageBus.js`
- `src/core/os/ServiceSupervisor.js`

These three files are **FULL at file-content level**. They are not new ports to perform again.

### Branch-only meaningful implementation paths
- `src/adapters/platform/node-host-adapter.js`
- `src/core/os/LocalStateStore.js`
- `src/core/platform/PlatformAdapterRegistry.js`
- `tests/core/os-local-state-store.test.js`
- `tests/core/platform-adapter-registry.test.js`
- `tests/core/platform-runtime-composition.test.js`
- `tests/core/mikrotik-hardware-adapter.test.js`

These are **NOT ABSORBED** until copied/reimplemented, reviewed, and tested.

### Existing but changed paths needing semantic diff
- `src/core/hardware/HardwareCapabilityRegistry.js`
- `src/adapters/hardware/mikrotik-hardware-adapter.js`
- `src/cli/commands/gateway.js`
- `src/core/agentRuntime.js`
- `src/domains/BaseDomain.js`
- `src/harness/AgentHarness.js`
- `package.json`, `package-lock.json`
- related architecture and lifecycle tests

These are **PARTIAL**: path existence is not absorption. Compare exports, call sites, authorization, lifecycle, failure handling and tests.

### Explicitly do not port as production code
- `.claude/settings.local.json`
- `agentos.podman.env`
- `br3eze-release-key.keystore`
- `error.log`, `test.log`
- generated raw `.security-review/**.err` files

These are local settings, environment material, signing material, logs, or generated tool output. The source branch's deletion of local secret/log files is a hygiene pattern to retain; never reintroduce those artifacts.

### Known limitation in the branch pattern
- The local state store scopes files by tenant/app/key naming, but it does not itself authenticate the caller or enforce authorization. It must sit behind trusted runtime policy.
- The IPC bus defaults to deny, which is a good pattern; its authorize callback must be supplied by trusted composition, not request payload.
- The platform registry expects trusted authorization context. Do not treat metadata grants passed by an untrusted caller as proof.
- The service supervisor and application manager are in-process lifecycle managers, not OS process isolation, a package sandbox, or a security kernel.


## Focused tree trace: port/missing-branch-patterns

Compared the full branch tree at `c072940ab2e90ca6681b3a4307ad7d1b9923f839` against current main:
- Branch tree: 2,317 files; main tree: 2,390 files at comparison time.
- 48 branch-only paths; 43 are generated `.security-review/**` raw audit artifacts.
- 4 meaningful branch-only paths:
  - `.github/workflows/cicd-contract.yml`
  - `.github/workflows/node.js.yml`
  - `docs/audits/branch-pattern-port-ledger.md`
  - `src/adapters/persistence/product-query-service.js`
- 92 shared paths have different blobs. Largest concentrations: `src/core` (21), `tests/unit` (20), workflows (13), `src/domains` (4), server code (3), payments (3).

Disposition: **PARTIAL / NOT ABSORBED**. Main already contains many files from this branch's feature families, but 92 modified shared paths need semantic comparison. The persistence adapter is a distinct pattern and remains unabsorbed. It dynamically loads the compiled product-query service, then wires SQLite and an optional document-store provider; it must be checked against the current product-query bridge, provider SDK, build output path, and fallback semantics before being promoted. Do not copy the generated raw security scan errors.

## Pattern families that must be traced separately

- **Autonomous operator (39 commits):** A2A task protocol, agent teams, mission dispatch, file task store, task registry, user task service, orchestration, workflow CI, lockless-manifest audit. Compare against current WBS/Runtime/SessionEventStore and ensure durable state + approval boundaries are not duplicated.
- **Supplier provisioning (7 commits):** transaction/idempotency guards and supplier provisioning domain. Verify tenant scope, atomicity, retry semantics, rollback, and tests.
- **Security hardening (8 commits):** security policy, outbound web MCP policy, security check script, CI security workflow. Preserve stricter fail-closed behaviour; never overwrite main's newer security logic by copying an older file.
- **General-purpose runtime (53 commits):** single runtime ownership, Kernel/Runtime boundaries, provider ports, lifecycle, approval/delegation, hardware capabilities, Node transformer and tests. The branch is a mixed portfolio; every path requires a semantic diff.
- **Linux Level 2 (63 commits):** service lifecycle, application manifest, IPC, local state, host adapters, platform adapter registry, hardware adapter, runtime composition, platform tests. Exact shared files are listed above; missing paths and changed blobs remain outstanding.
- **Node.js autograd (6 commits):** compare returned no changed-file list despite ahead commits. This is not sufficient evidence of full absorption; inspect its full tree and commit ancestry before closing.
- **Persistence/MikroTik tests (3 commits):** test changes only; run tests against current adapters and port any missing assertions without copying stale expectations.

## Absorption rule for all branches

For every unique path or logic pattern:
1. Compare source and destination by blob, not filename alone.
2. Trace exports/imports, constructors, call sites, dependency ownership, runtime entry points and side effects.
3. Preserve unique useful logic in the single canonical owner module.
4. Preserve unsuitable or conflicting patterns in an isolated experiment with a reason and source SHA; do not activate them.
5. Port/extend tests and run the narrow test first, then subsystem tests, then full CI.
6. Record exact destination path, source branch/SHA, source path, tests, commit, and state.
7. Mark FULL only after equivalent behaviour and tests are verified. File copied or commit cherry-picked alone is not full absorption.

## Current overall state

- Branch inventory: FULL for the 60 refs observed at this snapshot.
- Duplicate-head grouping: FULL for the 37 refs sharing one commit.
- Linux Level 2 pattern trace: PARTIAL; exact shared files and branch-only paths identified above.
- Remaining unique branch families: NOT ABSORBED or REVIEW until their file-level trace is completed.
- No claim is made that all 22 distinct branch heads are fully absorbed.
