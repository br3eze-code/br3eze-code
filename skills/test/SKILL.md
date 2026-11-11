---
name: test
description: Plan and run focused AgentOS tests, diagnose failures, assess regression risk, and report verifiable test evidence. Use when validating a code change, debugging CI, or preparing a release gate.
---

# AgentOS Test Engineering

## Mission

Provide evidence that a defined change behaves as intended without confusing a green focused test with a green repository. Testing observes and verifies the system; it does not become a second implementation or execution owner.

## Use this skill when

- Designing unit, integration, contract, or regression tests.
- Reproducing a bug or explaining a failing test.
- Checking whether a patch is ready for review or release.
- Investigating CI failures, flaky tests, test isolation, or coverage gaps.
- Verifying authorization, tenant scoping, idempotency, approval, audit, or adapter boundaries.

## Workflow

1. **Inspect the change.** Read the diff, affected code, nearby tests, package scripts, and relevant workflow configuration before proposing commands.
2. **Classify the gate.** Distinguish dependency installation, lint, type checks, unit tests, integration tests, build, security checks, and deployment checks. A failure before test execution is not a test failure.
3. **Choose the smallest useful test first.** Run a focused test for fast feedback, then expand to the relevant package and repository gates. Preserve the exact command and exit result.
4. **Test behavior and boundaries.** Include success, rejection, malformed input, duplicate/retry, authorization failure, and tenant or ownership boundaries where relevant. Prefer deterministic assertions over implementation-detail snapshots.
5. **Check architecture.** Verify that execution still routes through the canonical src/core/agentRuntime.js owner and that skills/adapters do not bypass authorization, approval, audit, or host execution controls.
6. **Diagnose without hiding.** Separate pre-existing failures from introduced failures using a known baseline when available. Do not delete, skip, weaken, or loosen a failing test merely to make CI green.
7. **Report honestly.** List commands run, pass/fail counts, skipped tests, environment constraints, and links to exact CI runs when available. Explicitly label any gate not run or not observed.

## Security-sensitive test rules

- Use test credentials and isolated fixtures; never print or commit real secrets.
- Avoid destructive operations against production, real tenants, live routers, or payment providers.
- Mock external side effects unless the task explicitly authorizes a safe test environment.
- Verify denied actions do not execute and authorization errors fail closed.
- Do not treat a passing unit test as proof of deployment health or production readiness.

## Completion criteria

The report names the exact revision tested, provides reproducible commands and observed results, identifies residual risks, and gives a clear go/no-go recommendation tied to evidence.

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
