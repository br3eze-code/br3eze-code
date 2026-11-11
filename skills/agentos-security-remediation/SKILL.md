---
name: agentos-security-remediation
description: Review and remediate Dependabot and dependency vulnerabilities in AgentOS repositories. Use for critical or high-severity alert triage, dependency-path analysis, specialist assignment, secure upgrades, regression testing, rollback planning, release gates, and audit evidence.
license: Complete terms in LICENSE.txt
---

# AgentOS security remediation

Use this skill to turn a vulnerability inventory into controlled remediation work. Do not claim that an alert is fixed until the advisory, affected dependency path, patch, validation evidence, and released version are recorded.

## Operating rules

1. Obtain the authoritative alert export before making package-specific claims. Prefer the repository security API or an exported Dependabot report. If access returns 403 or the payload is unavailable, record that limitation and use local audits only as supporting evidence.
2. Separate the repository aggregate count from the locally reproducible count. Do not assume `npm audit` equals Dependabot, and do not infer critical or high findings from an aggregate banner.
3. Preserve tenant, project, site, and domain scope when a vulnerability affects AgentOS runtime behavior, plugins, connectors, payment paths, or customer data.
4. Prioritize reachable critical and high findings, internet-facing packages, authentication and authorization dependencies, code execution or prototype-pollution paths, parsers, transport libraries, payment and commerce dependencies, and packages used in production builds.
5. Use the smallest safe upgrade first. Prefer a lockfile-only refresh when the patched version is compatible; use a major upgrade only with an explicit impact assessment and migration test.
6. Never suppress or dismiss an alert merely to reduce the count. A suppression requires documented reachability analysis, compensating controls, expiry, owner, and approval.
7. Keep remediation changes separate from unrelated feature work. One logical dependency family or security wave per commit where practical.

## Required inventory

Collect:

```text
Dependabot alert number and advisory ID
severity and CVSS information
package and vulnerable version range
fixed version or patched range
manifest and lockfile path
runtime, development, optional, or transitive scope
dependency chain to the root package
production reachability
CVE/GHSA references
current exploit or exposure context
```

Run repository-appropriate audits, for example:

```bash
npm audit --json
npm ls <package> --all
npm explain <package>
```

Also inspect all workspace manifests, plugin manifests, lockfiles, Dockerfiles, deployment descriptors, and generated bundles. Do not audit only the root package when the repository contains server, runtime, tools, Cordova, or extension packages.

## Specialist assignment

Use the following ownership model:

| Specialist | Security responsibility |
|---|---|
| Project Manager | Create remediation WBS, set priority, coordinate waves, approve scope changes, track risk and release readiness |
| Planner | Decompose alerts into packages, map dependencies and critical path, schedule upgrades, and track float |
| Engineer | Trace reachability, upgrade dependencies, patch compatibility issues, add regression tests, and prepare rollback |
| Accountant | Assess remediation cost, vendor exposure, support impact, and commercial risk; never treat an estimate as an actual |
| Secretary | Maintain decision records, owners, deadlines, stakeholder updates, and approved security communications |
| Procurement | Coordinate vendor advisories, replacement libraries, licenses, support contracts, and buy-versus-build decisions |
| Expeditor | Track upstream patch availability, release dates, supplier responses, and exceptions for blocked packages |
| Designer | Review user and operator impact, secure defaults, permission prompts, and safe recovery UX |
| Draftsman | Maintain controlled security diagrams, dependency maps, runbooks, and revision history |
| QA | Build acceptance criteria, run regression and security tests, verify evidence, and recommend release or rejection |
| Editor | Maintain the controlled remediation report, advisory references, changelog, review comments, and publication status |

## WBS remediation lifecycle

Create one WBS package per dependency family or tightly coupled advisory set:

```text
SEC-001 inventory and advisory verification
  → SEC-002 reachability and impact analysis
  → SEC-003 patch or upgrade proposal
  → SEC-004 compatibility implementation
  → SEC-005 security and regression validation
  → SEC-006 staged deployment and monitoring
  → SEC-007 closure, evidence, and residual-risk review
```

For each package, record the advisory IDs, package paths, owner, affected services, required evidence, target version, rollback version, and approval gate.

Each specialist action must create a stable activity number, for example:

```text
ACT-SECURITY-<ROLE>-<WBS-ID>
```

The activity must include expected outcome, acceptance criteria, evidence references, status, planned and actual effort, and handoff target.

## Priority waves

Use this order unless verified exploitability or production exposure justifies an override.

### Wave 0: containment

Immediately isolate or disable reachable critical paths when a vulnerable package is exposed through a public endpoint, authentication flow, code execution path, payment path, administrative interface, file parser, or connector. Add a temporary control only when it is reversible, tested, documented, and approved.

### Wave 1: critical findings

Address all 7 reported critical findings first. For each finding, verify whether it is reachable in production, identify the fixed release, upgrade the narrowest dependency path, run focused tests, and obtain Engineer and QA sign-off. Project Manager approval is required before deployment or any breaking migration.

### Wave 2: high findings with production reachability

Address high findings in this order:

```text
public runtime and API dependencies
identity, OAuth, session, and authorization paths
payment, order, transaction, and webhook paths
file, image, video, archive, and document parsers
network, proxy, WebSocket, and remote-management paths
database and query-layer dependencies
build and deployment tooling used in production
```

The reported 70 high findings should be batched by dependency family, not patched as one unreviewed bulk upgrade.

### Wave 3: high findings with limited or development-only exposure

Upgrade these after production-reachable high findings, while still recording reachability, compensating controls, and a deadline. Development-only status is not a permanent exemption if the package is included in release artifacts or CI runners that process untrusted content.

## Acceptance criteria

A critical or high advisory is ready for closure only when:

```text
fixed version is verified against the advisory
all affected manifests and lockfiles are updated
dependency tree no longer resolves the vulnerable range
production reachability is documented
focused regression tests pass
security-specific test or exploit regression is recorded
tenant isolation and approval gates remain intact
build, packaging, and platform checks pass
staged deployment evidence exists
rollback version and trigger are defined
QA recommends release
Project Manager records closure or residual risk
```

## Role-specific safety gates

Engineer must not apply dependency upgrades directly to production. Procurement must not select a replacement solely on price. Accountant must not mark projected remediation cost as actual. Secretary must not publish a security statement without approval. Expeditor must not report upstream remediation as complete until the patched release is available and consumed. QA must not accept a package because the test suite is green if the vulnerable range remains in the lockfile. Editor must preserve advisory references and revision history.

## Reporting format

Use a table with one row per advisory or dependency family:

| Field | Required content |
|---|---|
| Advisory | CVE/GHSA and Dependabot number |
| Severity | Critical, high, moderate, or low |
| Package path | Manifest, lockfile, and dependency chain |
| Exposure | Production, release artifact, CI-only, development-only, or unknown |
| Impact | Reachable behavior and affected AgentOS surface |
| Fix | Target version, patch, replacement, or mitigation |
| Owner | Specialist and accountable user |
| Activity | Stable activity number and WBS package |
| Validation | Tests, audit result, build, and deployment evidence |
| Rollback | Previous version and rollback trigger |
| Status | Open, contained, patching, validating, released, residual-risk, or closed |

## Handling unavailable alert access

If the security API cannot be read, state exactly that the live alert list is unavailable. Preserve the reported aggregate only as an unverified inventory summary, request an export containing advisory IDs and package paths, and continue with local audit and manifest analysis without claiming exact remediation coverage.

## Closure and residual risk

A residual-risk decision must identify the affected package, why it cannot be upgraded, reachability evidence, compensating controls, risk owner, expiry date, monitoring, and re-review trigger. Critical findings should not be accepted as residual risk without explicit executive or security-owner approval.

Finish every remediation wave with a signed evidence bundle containing the alert export, dependency diff, audit output, test results, deployment reference, rollback plan, and decision record.

## Shared AgentOS operating contract
This is specialist procedure, not a second execution system or permission grant.
### Architecture and ownership
- One execution owner: `src/core/agentRuntime.js`; compatibility shims are not parallel runtimes. Reuse the single gateway owner and its routes.
- WBS/work package = why/where; specialist = accountable who; skill = how; tool/adapter = what executes; policy = whether allowed; evidence/event = what happened; verification = acceptance.
- Follow identity/scope → WBS/dependencies → accountable specialist → skill → declared tool → policy/approval → bounded execution → observation → verification → evidence/event → next work item.
- Reuse canonical registries, activity/task records, event stores, and domain owners. PWA/web, CLI, desktop/mobile, and configured messaging channels are adapters, not alternate policy owners.
### Boundaries and handoffs
- Own only this skill's state/record. Route by the state that changes, not the channel or phrasing. Every work package needs owner, dependencies, capability/skill, tools, policy, acceptance criteria, evidence, outcome, and activity/event record.
- Handoffs include source/destination owners, WBS/activity IDs, tenant/project/site/domain scope, object IDs, requested action, evidence, due date, acceptance criteria, approval status, and return path.
- Keep catalog, pricing, inventory, orders, vouchers/access, fulfillment, procurement, and billing/payment ownership separate. Project Manager coordinates; Product Specialist routes commerce; neither silently assumes domain authority.
### Permissions and safe execution
- Skill prose is not authorization. Validate identity, tenant/project/site/domain, environment, object scope, capability, and policy before access or mutation.
- Prefer read-only inspection/dry runs. Recheck authorization before consequential changes. Approval is required for irreversible, high-value, externally visible, security-sensitive, payment, deployment, device/network, or contractually binding actions.
- Never expose secrets, tokens, OTPs, passwords, or unnecessary personal data. Enforce tenant isolation and redact evidence/logs.
- Use stable IDs, explicit state transitions, idempotency, bounded retries/timeouts, and safe failure handling. Enforce `maxIterations`, `maxToolCalls`, `maxCost`, `maxDurationMs`, and `maxHandoffs` where supported; escalate if limits or authority are insufficient.
### Evidence and verification
- Record baseline, risks, approvals, changed resources, tool results, tests, observed result, evidence references, defects, and rollback/recovery status through existing activity/audit paths.
- Define acceptance and rollback before mutation. Add regression tests; run focused tests, relevant lint/build checks, and CI. Keep manifests/lockfiles consistent; run `npm ci` when required by repository workflows.
- Never claim tests, devices, providers, deployments, or live tenants were verified without observed results. Separate code inspection, unit tests, staging, and production evidence.
- Report outcome, owner, changes, exact checks/results, evidence, risks, approvals, and next handoff.
### Provider and environment boundaries
- Providers are swappable; every capability still has one owner. Keep Firebase, Supabase/Postgres, Vercel, AWS, Cloudflare, payment/messaging, MikroTik/RouterOS, and Starlink behavior behind adapters unless core explicitly owns it.
- Mentioned integrations do not prove live credentials or connectivity. Use only configured/authorized tools. Do not assume browser `process`, filesystem, secrets, Node APIs, or network access exist in a PWA; use the proper server/API boundary.
- Separate product entitlement/billing from router/device mutation. Disruptive network operations need scoped permission, confirmation, audit, and post-change verification.
### skills.sh compatibility
- Maintain YAML frontmatter with stable `name` and useful `description`; preserve specialist-specific instructions.
- Install with `npx skills add br3eze-code/br3eze-code --skill <skill-name>`; `npx skills list` shows workspace-installed skills, not every source package. Repository guidance specifies Node.js 22.20+.
- Installation is not runtime registration; skill prose must not replace executable modules or create another execution path.
