# AgentOS Dependabot remediation plan

## Evidence status

GitHub reported an aggregate of 131 vulnerabilities on the default branch: 7 critical, 70 high, 44 moderate, and 10 low. The current GitHub integration returned HTTP 403 when requesting the alert list, so individual advisory IDs, package names, fixed versions, and dependency paths are not yet verified.

The root local `npm audit --json` reported 16 moderate, 0 high, and 0 critical vulnerabilities. This is supporting evidence only and is not equivalent to the Dependabot inventory. The repository contains multiple package surfaces, including root, server, runtime, tools, Cordova plugins, VS Code extension, and a Cordova SQLite lockfile.

## Immediate control

Do not close or dismiss any of the reported critical or high alerts based only on the aggregate count or root `npm audit`. Obtain a Dependabot export or API access containing advisory number, CVE/GHSA, package path, vulnerable range, fixed version, dependency scope, and alert state.

Until the alert export is available, freeze unrelated dependency upgrades on affected production paths, ensure lockfiles are committed, and review public endpoints, authentication, payment, file parsing, remote-management, and webhook surfaces for reachable vulnerable packages.

## Remediation waves

| Wave | Scope | Primary owner | Exit gate |
|---|---|---|---|
| 0 | Inventory, containment, and production reachability | Project Manager + Engineer + QA | Alert export, dependency graph, emergency controls, and risk register |
| 1 | All 7 critical findings | Engineer + QA | Patched range resolved, focused security tests, compatibility tests, rollback, release approval |
| 2A | High findings in public runtime, auth, payment, webhook, parser, network, and remote-access paths | Engineer + QA, with Procurement for replacements | No vulnerable range in production lockfiles and staged deployment evidence |
| 2B | High findings in server, runtime, Cordova, desktop, and release-artifact paths | Engineer + platform owners | Platform builds, plugin tests, packaging checks, and channel regression evidence |
| 3 | High findings limited to development or CI-only paths | Engineer + Planner | Reachability evidence, patched lockfile, CI validation, or approved time-bounded residual risk |
| 4 | Moderate and low backlog | Planner + Engineer + QA | Scheduled maintenance wave and dependency hygiene report |

## Specialist work packages

```text
SEC-001 verify alert export and manifests
SEC-002 map advisory to dependency path and production reachability
SEC-003 assess impact, containment, and upgrade options
SEC-004 implement smallest safe patch
SEC-005 run security, tenant-isolation, channel, and platform regression tests
SEC-006 stage deployment, monitor, and verify rollback
SEC-007 close advisory with evidence or approve time-bounded residual risk
```

Assign stable activities using:

```text
ACT-SECURITY-<ROLE>-<WBS-ID>
```

## Specialist responsibilities

| Specialist | Assigned responsibility |
|---|---|
| Project Manager | Own the security WBS, priority decisions, exceptions, change approvals, release readiness, and closure |
| Planner | Build the dependency-family schedule, critical path, float, resource plan, and remediation dashboard |
| Engineer | Trace reachability, update manifests and lockfiles, patch compatibility problems, write regression tests, and prepare rollback |
| Accountant | Estimate remediation effort and commercial impact, reconcile support or replacement costs, and separate estimates from actuals |
| Secretary | Maintain decisions, owners, deadlines, security notices, evidence index, and distribution controls |
| Procurement | Source maintained replacements, validate licenses and vendor support, and prepare buy-versus-build or re-tender options |
| Expeditor | Track upstream patch releases, vendor responses, blocked dependencies, and delivery of replacement packages |
| Designer | Review secure defaults, operator workflows, permission prompts, and customer impact from mitigation or upgrade changes |
| Draftsman | Maintain dependency maps, architecture diagrams, runbooks, and controlled revision history |
| QA | Define acceptance criteria, reproduce advisory behavior where safe, run regression/security tests, verify lockfiles, and recommend release or rejection |
| Editor | Maintain the advisory register, remediation report, change log, review comments, and publication-controlled final report |

## Critical finding procedure

For each of the 7 critical alerts:

1. Verify the advisory and affected package from the Dependabot export.
2. Identify every manifest and lockfile that resolves the vulnerable range.
3. Determine whether the vulnerable code is reachable in production, release artifacts, CI, or only local development.
4. Apply a reversible containment control if a reachable production path is exposed.
5. Select the smallest patched version that preserves compatibility.
6. Run focused tests, tenant-isolation tests, approval-gate tests, payment/order/courier tests where relevant, and platform builds for affected surfaces.
7. Deploy to staging, monitor, verify the patched dependency is actually loaded, and exercise rollback.
8. Close only with Engineer implementation evidence, QA recommendation, Project Manager decision, and controlled Editor record.

## High finding prioritization

The 70 high findings should be grouped by package family and runtime exposure:

```text
1. Public API and runtime dependencies
2. OAuth, authentication, sessions, authorization, and identity
3. Payment, order, transaction, and webhook dependencies
4. File, image, video, archive, document, and XML parsers
5. Network, proxy, WebSocket, MikroTik, Starlink, and remote-management paths
6. Database, SQL, Firebase, and query-layer dependencies
7. Cordova, Android, iOS, Electron, desktop, and PWA release artifacts
8. CI, build, test, and development-only dependencies
```

Do not apply a single bulk upgrade to all 70 findings. Batch by dependency family, run the smallest relevant regression set, and commit each wave separately.

## Release gates

A critical or high finding is not resolved until all of the following are true:

```text
advisory identity verified
fixed release verified
all affected dependency paths updated
vulnerable range absent from production lockfiles
production reachability recorded
focused security regression passed
tenant isolation and approval gates passed
platform and packaging checks passed
staging deployment verified
rollback version and trigger recorded
QA recommends release
Project Manager approves release or time-bounded residual risk
```

Critical residual risk requires explicit security-owner or executive approval, a compensating control, owner, expiry date, monitoring, and re-review trigger.

## Required evidence bundle

Store the following for every remediation package:

```text
Dependabot export or advisory reference
dependency graph and manifest paths
before/after lockfile diff
reachability assessment
patch and migration notes
security regression output
full relevant test output
build and packaging output
staging deployment reference
monitoring result
rollback procedure
approval and decision record
```

## Current limitation and next action

The exact 7 critical and 70 high findings cannot be individually prioritized until the Dependabot alert export is supplied or GitHub API access is granted. The next action is therefore to obtain that export, populate the advisory register, and instantiate one WBS package per dependency family or coupled advisory set. The aggregate count must not be used as proof that any particular package is vulnerable or fixed.
