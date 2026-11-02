# Branch pattern port review — 2026-11-02

## Scope and method

Compared the current `main` tree against the following divergent refs using GitHub commit comparisons and file-level reads:

- `port/missing-branch-patterns`
- `refactor/general-purpose-single-runtime`
- `refactor/linux-single-runtime-boundaries`
- `feat/autonomous-operator-foundation`
- `patch/security-hardening-2026-11`
- `feat/supplier-provisioning-transaction-guards`
- `port/nodejs-autograd-current-main`
- `port/security-hygiene-current-main`
- `test/persistence-and-mikrotik-adapter-paths`
- documentation-only refs

These refs are significantly behind and/or diverged from current `main`. Their ahead counts are not a safe merge plan. A branch compare includes changes relative to a merge base; it does not mean every listed change is missing from current `main`.

## Already present on main — do not port a second copy

File-level content hashes matched between branch and main for representative patterns:

- Node.js tensor/autograd and transformer foundations under `experiments/llm-js/` and `src/llm/`
- Trainable classifier foundation
- Repository hygiene gate and tests
- Hardware capability registry
- Web MCP outbound policy
- Supplier provisioning service and tests (main has additional request fingerprints, supplier URL validation, and line validation)
- Security hygiene workflow and inventory foundations

The current main versions of `scripts/security-check.js`, `src/core/taskRegistry.js`, and `src/core/file-task-store.js` contain additional current-main behavior. They were not replaced with older branch versions.

## Ported to main

### Managed application platform primitives

- `src/core/os/ServiceSupervisor.js`: bounded in-process service lifecycle and failure reporting.
- `src/core/os/IPCMessageBus.js`: tenant-scoped, authorization-gated in-process messaging with bounded JSON payloads and audit hooks.
- `src/core/os/ApplicationManager.js`: declarative app registration and lifecycle delegation.
- `src/core/os/index.js`: one composition entry point; it composes these primitives and does not create a second AgentRuntime.
- `src/adapters/persistence/local-state-store.js`: tenant/app-scoped local JSON state adapter. It was moved out of `src/core` because Node filesystem access is an adapter concern.
- `tests/core/os-managed-platform.test.js` and `tests/core/local-state-store.test.js`: lifecycle, authorization, tenant isolation, composition and persistence tests.

The service supervisor and IPC bus are in-process mechanisms for trusted code. They are not process isolation, a sandbox, or a bootable operating-system kernel. App manifest permissions are descriptive inputs to the trusted service context; they are not an OS-enforced sandbox.

### Selective security hardening

- `src/core/security.js` now rejects ephemeral encryption keys in production.
- Audit-body redaction now traverses nested objects/arrays, detects cycles and bounds recursion.
- Content Security Policy no longer permits `unsafe-eval`. Legacy `unsafe-inline` remains temporarily and should be migrated to nonces/hashes.
- `tests/unit/core/security.test.js` covers production key enforcement and nested redaction.

Production deployments that instantiate `SecurityManager` must provide `AGENTOS_MASTER_KEY` through a secret manager/environment variable. Never commit the key.

## Deliberately not ported

- `src/adapters/platform/node-host-adapter.js`: its capability shape uses `invoke`, while the current canonical `HardwareCapabilityRegistry` requires `execute`. Porting it unchanged would create an incompatible second adapter contract.
- `src/core/platform/PlatformAdapterRegistry.js`: not added until a concrete gap is demonstrated; the current runtime already has a canonical hardware capability registry and tool registry. A second registry risks duplicate capability ownership.
- The branch's provider-specific product-query bridge rewrite: current main already has a persistence-port bridge and a distinct host-composition path. The branch adapter was not wired into the actual persistence provider registration, so copying it alone would be dead code.
- Older task registry, task store, security-check, supplier provisioning, and LLM implementations: current main has newer or already-identical implementations.

## Removal decisions

No production implementation was deleted merely because its directory or name looked duplicated. No old branch was force-merged. The only code relocation was moving the filesystem-backed state store from core to the persistence adapter layer; its test import was updated accordingly.

Branch deletion was not performed. A branch is removable only after its unique commits are accounted for and its open PR is closed or merged. This pass did not establish that condition for every branch.

## Verification status

GitHub Actions runs for the latest main commits were still queued/pending when inspected. The new tests have been committed, but their pass status is not yet proven. Do not treat this document or a successful commit API response as evidence of passing tests or a production deployment.
