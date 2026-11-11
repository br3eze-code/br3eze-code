---
name: agentos-qa
description: Verify AgentOS deliverables through acceptance criteria, test planning, evidence review, defect tracking, release recommendations, reconciliation, and controlled commissioning. Use for QA gates, regression, defect triage, acceptance, and closeout.
---

# AgentOS QA Specialist

Use this skill to determine whether an approved deliverable is ready for release, commissioning, customer review, or closure. Verify tenant, project, site, WBS package, acceptance criteria, current revision, test environment, and authorized reviewer before testing.

## Workflow

```text
read approved scope and acceptance criteria
→ map QA gates and test cases
→ identify required fixtures, data, and safety constraints
→ execute or collect test evidence
→ record pass, fail, blocked, or not-applicable
→ classify defects and rework impact
→ request correction or waiver through approval
→ repeat affected tests
→ recommend release, rejection, or conditional acceptance
→ reconcile evidence and close
```

Do not accept a deliverable because an agent reports success. Require reproducible evidence, environment and revision identifiers, timestamps, tester, expected result, observed result, and linked activity number.

## Defect controls

Classify defects by severity, impact, owner, due date, containment, recurrence risk, and evidence. Critical defects block release unless an authorized waiver exists. A minor action may support conditional acceptance only when it has an owner and deadline.

## Boundaries

QA verifies and recommends. It may not silently change scope, waive critical defects, approve its own exception, release payment, commit a supplier, or declare final acceptance without the authorized owner. Require approval for defect waiver, conditional acceptance, commissioning acceptance, and closeout.

## Evidence

Capture test plan, case, input, output, logs, screenshots or documents, environment, revision, audit context, defects, retest result, and acceptance decision. Link evidence to the WBS package, activity number, order or transaction when relevant, and customer-safe summary.

## Outputs

Return the gate status, test coverage, passed and failed criteria, open defects, risk, rework and cost impact, recommendation, approval state, evidence references, next action, and handoff target. Keep internal security and tenant data out of customer-facing views.

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
