# AgentOS production completion register

## Baseline

The current branch is `upgrade/commerce-domains` at commit `2e563de`. The branch contains the production Dockerfile, gateway and fleet-worker Compose topology, tag-based GHCR release workflow, matrix registry, roaming context, approval/resource/audit governance, regional access, and focused control-plane tests. The local runtime file `state/payment-ledger.sqlite.json` is intentionally excluded from source control.

The attached execution plan defines a target of 95/100 before using an unrestricted production-ready claim. This register is the source of truth for the remaining work. A task is not marked complete because code exists; it requires reproducible evidence, an environment identifier, revision, test result, and acceptance owner.

## Work matrix

| ID | Work package | Current state | Release impact | Acceptance evidence |
|---|---|---|---|---|
| P0-01 | Freeze core/domain boundary and publish architecture manifests | Partial. Matrix documentation exists, but core/adapters are not yet mechanically certified by import-boundary tests. | High | Core-only import test; `CORE-MANIFEST.json`; adapter manifest validation |
| P0-02 | Formal versioned contracts for work, loop, action, evidence, authority, policy, adapter, and plugin | Partial. Runtime contracts are distributed across modules and tests; no single versioned contract registry is authoritative. | High | Schema validation and compatibility tests |
| P0-03 | Plugin lifecycle, dependency, health, isolation, enable/disable | Partial. `src/plugins/registry.js` and plugin SDK exist; removal/restart certification is not complete. | High | Remove-plugin restart test with core-only boot |
| P0-04 | Matrix assignment, capacity, conflict, authority, delegation, and allocation engines | Partial. Matrix registry, resource governance, and approval gate exist; several named engines remain implicit or distributed. | High | Detection tests for double assignment, overflow, authority, skill, schedule, scope, and approval conflicts |
| P0-05 | Specialist → skill → capability → tool → adapter authorization | Partial. SpecialistRuntime and capability policy exist; complete adapter manifest and permission proof is incomplete. | Critical | Unauthorized mutation denial with audit evidence |
| P0-06 | Universal execution evidence chain | Partial. Audit and loop governance exist; every action does not yet have a mandatory intent-to-outcome evidence envelope. | Critical | End-to-end action evidence contract test |
| P1-01 | Durable gateway deployment | Implemented as artifacts; Docker build and Compose rendering require CI/host validation because Docker is unavailable in the sandbox. | Critical | CI build, Compose config, image scan, startup/health test |
| P1-02 | Durable fleet worker | Partial. Worker bootstrap is present, but provider adapter, durable snapshot persistence, dead-letter handling, and lease store are deployment responsibilities. | Critical | 1,000-target load test; restart/resume; duplicate-work and dead-letter tests |
| P1-03 | Database/RLS migration and backup/restore | Partial. Mesh schema and PostgreSQL adapter exist; production migration rehearsal and restore proof are outstanding. | Critical | Migration on clean and upgraded database; RLS cross-tenant tests; restore drill |
| P1-04 | Secrets, ingress, TLS, rotation, and runtime configuration | Partial. Environment/config precedence is implemented; secret-manager integration and ingress policy are external deployment gates. | Critical | Secret scan; rotation rehearsal; TLS and origin test |
| P1-05 | Observability and incident recovery | Partial. Audit, notifications, health endpoints, and logs exist; metrics/SLOs, alert routing, and runbooks are incomplete. | High | Dashboard, alert, trace, and recovery evidence |
| P2-01 | Multi-tenant, multi-site, multi-router roaming parity | Partial. Shared context exists for Telegram/WhatsApp and legacy Telegram; PWA, CLI, mobile, and desktop parity require integration tests. | Critical | Cross-channel scope and approval-expiry matrix |
| P2-02 | Provider-neutral MikroTik/Starlink polling | Partial. Poller contract exists; real provider adapter behavior, timeout budgets, and node fingerprint quarantine need production fixtures. | Critical | Provider contract tests and failure-injection load test |
| P2-03 | Site-level health aggregation and alert storm control | Partial. Aggregation primitive exists; durable event lifecycle, suppression, and notification delivery need operational proof. | High | Fleet-wide incident aggregation and recovery test |
| P2-04 | Router onboarding and fingerprint verification | Partial. Mesh management and access adapter exist; quarantine/reverification and channel onboarding acceptance are incomplete. | Critical | Unauthorized fingerprint and tenant/site mismatch tests |
| P3-01 | Dependency remediation | Open. `npm audit` reports 16 moderate transitive advisories, mainly Firebase/Google Cloud and Cordova/Xcode paths. | High | Upgrade or approved isolation waiver with scan evidence |
| P3-02 | Cross-platform build parity | Partial. Linux, Windows, Cordova, web, desktop, and mobile tests exist; production artifact builds and device-level acceptance are not complete. | High | Matrix build on supported runners |
| P3-03 | Product/plugin certification | Partial. Product/domain modules exist in the monorepo; removable-domain certification is not complete. | Medium | Remove MikroTik, commerce, and provider adapters; core remains healthy |
| P3-04 | Production scorecard and controlled commissioning | Open. No signed owner-approved scorecard with architecture, security, authority, audit, observability, CI/CD, plugin, and deployment scores. | Critical | QA recommendation, PM baseline, risk register, and commissioning approval |

## Release rule

Until all Critical items have passed acceptance evidence or have an authorized, time-bound waiver, the system is suitable only for isolated staging or a constrained pilot. Moderate dependency findings may be accepted only when their transitive path is isolated, monitored, and assigned an owner with a remediation date.

## Immediate execution order

The safe order is: container build and migration rehearsal; durable worker provider and snapshot contracts; cross-channel parity; core/adaptor boundary certification; mandatory execution evidence; dependency remediation; then 1,000-target scale and recovery testing. This order prevents scale testing from masking authority, persistence, or deployment defects.
