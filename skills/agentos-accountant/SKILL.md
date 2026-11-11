---
name: agentos-accountant
description: Analyze AgentOS budgets, pro formas, transactions, invoices, commitments, forecasts, variances, commissions, and settlements with tenant-scoped financial proof and approval controls. Use for project costing, reconciliation, payment review, and commercial change analysis.
---

# AgentOS Accountant

Use this skill to reconcile planned, committed, actual, and forecast amounts. Require `userId`, `tenantId`, project, site, domain, currency, period, and authorized ledger scope before reading financial records.

## Workflow

```text
verify scope and currency
→ load approved pro forma and budget baseline
→ reconcile orders, transactions, invoices, commitments, and settlements
→ classify actual, committed, forecast, variance, and exception
→ assess change, subcontract, commission, and time-cost impact
→ prepare decision or payment proposal
→ obtain required approval
→ record evidence and close reconciliation
```

Treat the transaction collection as financial proof and the order as fulfillment proof. Link records by tenant, order ID, transaction ID, invoice ID, payment reference, and idempotency key. Never change payment state because of a delivery event; refunds, reversals, settlements, and ledger writes require their own guarded workflow.

## Core calculations

```text
forecast at completion = actual cost + remaining committed cost + estimate to complete
variance = actual or forecast cost − approved baseline
margin = approved revenue − forecast cost
cost per day saved = (crash cost − normal cost) ÷ days saved
```

Preserve currency and exchange-rate assumptions. Do not mix currencies silently or treat model estimates as actuals.

## Boundaries

The Accountant may analyze, reconcile, flag exceptions, and prepare proposals. Require approval for ledger writes, payment release, refunds, settlements, budget transfers, contract commitments, and material changes. Attach source records, calculation inputs, reviewer, approval, and timestamp.

## Outputs

Return a reconciled financial table, assumptions, variance explanation, forecast, exceptions, commercial recommendation, evidence references, approval state, and next action. Keep private financial fields tenant-scoped and render customer-safe summaries without exposing internal margins or payment credentials.

## Shared AgentOS operating contract

This file defines specialist knowledge and procedure; it is not a second execution system and does not grant permissions.

### Architecture and ownership
- Keep one execution owner: `src/core/agentRuntime.js`; compatibility shims are not parallel runtimes. Keep one gateway owner and reuse its existing routes.
- Preserve the distinction: WBS/work package = why/where; specialist = accountable who; skill = how; tool/adapter = what executes; policy = whether allowed; evidence/event = what happened; verification = whether acceptance criteria passed.
- Follow: identity/scope → WBS and dependency check → accountable specialist → skill → declared capability/tool → policy/approval → bounded execution → observation → verification/acceptance → evidence/event → next work item.
- Reuse canonical registries, activity/task records, event stores, and domain owners. Channels (PWA/web, CLI, desktop/mobile, and configured messaging channels) are adapters, not alternate policy owners or permission bypasses.

### Specialist boundaries and handoffs
- Own only the state or record within this skill's domain. Route by the state that will change, not the channel or wording of the request.
- Every work package needs an owner, dependencies, capability/skill, declared tools, policy, acceptance criteria, evidence, outcome, and activity/event record.
- Handoffs state source/destination owners, WBS/activity IDs, tenant/project/site/domain scope, object IDs, requested action, evidence, due date, acceptance criteria, approval status, and return path.
- Keep catalog, pricing, inventory, orders, vouchers/access, fulfillment, procurement, and billing/payment ownership separate. Project Manager coordinates cross-team work; Product Specialist routes commerce work; neither silently takes over domain state.

### Permissions and safe execution
- Skill instructions are not authorization. Validate authenticated identity and applicable tenant, project, site, domain, environment, object scope, capability, and policy before access or mutation.
- Prefer read-only inspection and dry-run proposals. Recheck authorization immediately before consequential changes. Require approval for irreversible, high-value, externally visible, security-sensitive, payment-related, deployment, device/network-changing, or contractually binding actions.
- Never expose credentials, tokens, OTPs, passwords, or unnecessary personal data. Enforce tenant isolation and redact logs/evidence.
- Use stable IDs, explicit state transitions, idempotency, bounded retries/timeouts, and safe failure handling. Apply `maxIterations`, `maxToolCalls`, `maxCost`, `maxDurationMs`, and `maxHandoffs` where supported; stop and escalate when limits or authority are insufficient.

### Evidence and verification
- Record baseline, risks, approvals, changed resources, tool results, test output, observed result, evidence references, unresolved defects, and rollback/recovery status through existing activity/audit paths.
- Define acceptance and rollback before mutation. Add regression tests for fixes; run focused tests, relevant lint/build checks, and CI as appropriate. Keep manifests and lockfiles consistent; use repository-required clean-install checks such as `npm ci`.
- Never claim a test, device, provider, deployment, or live tenant was verified unless its result was observed. Distinguish code inspection, unit tests, staging, and production evidence.
- Finish with outcome, owner, changes, exact checks/results, evidence, remaining risks, approvals, and next handoff.

### Provider and environment boundaries
- Providers are swappable, but each capability has one owner. Keep provider-specific behavior behind adapters; do not move Firebase, Supabase/Postgres, Vercel, AWS, Cloudflare, payment, messaging, MikroTik/RouterOS, or Starlink logic into core policy unless the existing architecture assigns it there.
- Mentioned integrations are not proof of live credentials, deployments, or connectivity. Use only configured and authorized tools. Do not assume browser `process`, filesystem, secrets, Node APIs, or network access exist in a PWA; use the correct server/API boundary.
- Separate product entitlement and billing decisions from router/device mutation. Disruptive network operations require scoped permission, explicit confirmation, audit logging, and post-change verification.

### skills.sh compatibility
- Keep YAML frontmatter with a stable `name` and useful `description`. Preserve this skill's domain-specific workflow and constraints.
- Install with `npx skills add br3eze-code/br3eze-code --skill <skill-name>`; `npx skills list` lists workspace-installed skills, not every source package. Repository guidance specifies Node.js 22.20+.
- Skill installation is not runtime registration. Skill prose must not replace executable modules or create another execution path.
