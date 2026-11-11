# Br3eze AgentOS Release WBS

Use this as a baseline, then create durable project-specific activities and assign one accountable owner to each item. Stage gates are sequential unless an explicit dependency permits parallel work.

| WBS | Stage | Accountable owner | Exit evidence |
|---|---|---|---|
| 1.0 | Baseline and release charter | Project Manager | Commit/branch, scope, constraints, current PR/CI/deploy state, risks and approval owner recorded |
| 1.1 | Requirements and UX/design | Designer | Approved flows, responsive states, accessibility and design handoff |
| 1.2 | Technical design and dependencies | Engineer + Security reviewer | Ownership boundaries, dependency rationale, threat model and interfaces |
| 2.0 | Implementation | Engineer | Small scoped diff, code review, tests for changed behavior |
| 2.1 | Data/API/provider adapters | Relevant domain specialist | Contract tests, authorization, idempotency and provider failure handling |
| 2.2 | Cordova/mobile integration | Cordova specialist | Plugin compatibility, permissions, offline/error behavior and supported-device checks |
| 3.0 | QA and regression | QA | Unit/integration/smoke results, reproducible evidence, known defects and acceptance decision |
| 3.1 | Security and supply chain | Security specialist | Secret scan, dependency/licence review, permissions/CSP review and accepted risk disposition |
| 4.0 | Web/Vercel candidate | Vercel specialist | Lockfile install, build output verified, route/API smoke tests, preview URL and deployment evidence |
| 4.1 | Android release candidate | Android release specialist | Version/versionCode, signed artifact via approved secrets, checksum and internal test evidence |
| 5.0 | Distribution approval | Human release owner | Explicit approval, privacy/data safety, release notes, rollout scope and rollback plan |
| 5.1 | Android staged distribution | Android release specialist | Verified Play track/version/rollout evidence; no assumption based on local build |
| 5.2 | Web production launch | Vercel specialist + release owner | Verified deployment, health/routes/API smoke checks and rollback reference |
| 6.0 | Launch monitoring | Live Project Observer | Event source coverage, error/crash signals, alert routing and monitoring freshness |
| 6.1 | Closeout and handover | Project Manager + QA | Acceptance evidence, unresolved risks, runbook, rollback, owners and lessons learned |

## Gate policy

A stage is blocked if its exit evidence is missing. Conflict-free PRs are not automatically merge-ready. Do not bypass failing required checks. Do not publish Android or production web changes without explicit approval. Keep the Android and Vercel release evidence separate.

## Next priority rule

At each checkpoint, choose the highest-impact unblocked prerequisite that reduces release risk. At current planning stage, validate portable skill metadata and CI; next, stabilize the existing dependency/build failures; then verify WBS stage execution and the read-only observer against real event sources.
